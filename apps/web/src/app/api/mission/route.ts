// Runs a mission and streams the agent's work to the browser as Server-Sent Events.
// Phase 1 plans the goal and runs until the first unanswered checkpoint ("check with me" mode).
// Phase 2 (same runId + selections) reuses phase-1 results and finishes the mission.
import { z } from "zod";
import {
  MISSIONS,
  MISSION_TYPES,
  blankTrip,
  checkpointOptions,
  cleanProfile,
  createContext,
  missionSkills,
  missionSteps,
  normalizeArtistName,
  pendingCheckpoints,
  planGoal,
  runBrief,
  sanitizeSelections,
  type BriefEvent,
  type BriefInput,
  type Plan,
  type SkillResult,
} from "@backline/engine";
import { getRun, isRunId, saveRun } from "@/lib/run-store";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseConfig } from "@/lib/supabase";
import { loadAccount, mergeProfile, recentBooking, rememberTastes, saveSearch, saveTripAndMemories } from "@/lib/account";
import { passportForBooking } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  goal: z.string().max(2000).optional(),
  artist: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  mission: z.enum(MISSION_TYPES).optional(),
  /** The artist this user works with, remembered in their browser. Used when a goal doesn't name one. */
  defaultArtist: z.string().max(120).optional(),
  autonomy: z.enum(["check", "auto"]).default("check"),
  runId: z.string().optional(),
  selections: z.record(z.array(z.string().max(80)).max(12)).optional(),
  /** What the agent knows about this user (kept in their browser). Validated again by the engine. */
  profile: z.record(z.unknown()).optional(),
  /** The user's local date (YYYY-MM-DD), so "next weekend" means their next weekend. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Files the user attached, already read into text by /api/documents. Treated as data. */
  documents: z
    .array(z.object({ name: z.string().max(200), text: z.string().max(60_000), kind: z.string().max(20).optional(), truncated: z.boolean().optional() }))
    .max(3)
    .optional(),
  /** The person tapped "Run again": book this again even if it was booked a moment ago. */
  rebook: z.boolean().optional(),
  /** Ask for diagnostics (model timings, fallbacks, warnings). Honoured in development, or with BACKLINE_DEBUG=1. */
  debug: z.boolean().optional(),
});

const DEBUG_ALLOWED = process.env.NODE_ENV !== "production" || process.env.BACKLINE_DEBUG === "1";

const rateLimited = rateLimiter(12);

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(429, "You're starting missions too quickly. Wait a minute and try again.");

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail(400, "Check your request and try again.");
    body = parsed.data;
  } catch {
    return fail(400, "Check your request and try again.");
  }
  const documents = (body.documents ?? []).filter((d) => d.text.trim().length > 0);
  if (!body.goal?.trim() && !body.artist?.trim() && !body.runId && documents.length === 0) return fail(400, "Tell the agent what you want to get done.");

  // In debug mode, warnings are also collected and sent back at the end (never keys or content).
  const debug = Boolean(body.debug && DEBUG_ALLOWED);
  const startedAt = Date.now();
  const logs: { level: string; msg: string; meta?: unknown; at: number }[] = [];
  const keep = (level: string) => (msg: string, meta?: Record<string, unknown>) => {
    (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(`[engine] ${msg}`, meta ?? "");
    if (debug && level !== "info" && logs.length < 120) logs.push({ level, msg, meta, at: Date.now() - startedAt });
  };

  let ctx: ReturnType<typeof createContext>;
  try {
    ctx = createContext(process.env, { signal: req.signal, log: { info: keep("info"), warn: keep("warn"), error: keep("error") } });
  } catch (err) {
    console.error("[mission] configuration error", err instanceof Error ? err.message : err);
    return fail(503, "The agent isn't configured yet.");
  }

  // Signed in: run with their saved details and what the agent remembers, and save the trip after.
  const session = await getSession().catch(() => null);
  const account = session ? await loadAccount(session).catch((err) => (console.warn("[mission] account load failed", err instanceof Error ? err.message : err), null)) : null;
  // Their passport, decrypted for this mission's booking calls only (never sent to the model or the browser).
  if (session) ctx.traveller = { passport: await passportForBooking(session).catch(() => null) };
  // With sign-in switched on, only a signed-in person can have things bought, sent or called for them.
  // Anyone else still gets the full plan, with the booking links to use themselves.
  if (!session && supabaseConfig()) {
    ctx.signedOut = true;
    ctx.hotels = null;
    ctx.flights = null;
    ctx.email = null;
    ctx.calls = null;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => send("ping", {}), 15_000);
      // Model and web-research calls since this mission started: timing and outcome, never content.
      const services = () => ({ llm: ctx.llm?.recentCalls(startedAt) ?? [], web: ctx.web?.recentCalls?.(startedAt) ?? [], resting: ctx.llm?.resting() ?? [] });
      let sendDebug = () => {
        if (debug) send("mission.debug", { planner: null, ...services(), logs, usage: ctx.usage.snapshot() });
      };

      try {
        // Resume an earlier run if we still have it; otherwise plan from scratch.
        const prior = isRunId(body.runId) ? getRun(body.runId) : null;
        const runId = prior && isRunId(body.runId) ? body.runId : crypto.randomUUID();
        const local = cleanProfile(body.profile);
        const merged = account ? mergeProfile(account.profile, local, account.memories) : local;
        // Signed in with Google or email: their name and email are enough to book in their name.
        const profile = session ? { ...merged, name: merged.name || session.user.name || undefined, email: merged.email || session.user.email || undefined } : merged;
        let plan: Plan;
        if (prior) {
          plan = prior.plan;
        } else {
          plan = await planGoal(
            ctx.llm,
            body.goal?.trim() || body.artist?.trim() || "Plan this for me using the attached document.",
            { artist: body.artist, location: body.location, mission: body.mission, profile, today: body.today, documents },
            req.signal
          );
          // Where they're travelling from, so getting there, fares and the journey in are never blank:
          // what they said, else their home city, else the city their connection comes from (said so).
          if (plan.trip && !plan.trip.origin) {
            const from = profile.homeCity?.trim() || cityFromRequest(req);
            if (from) {
              plan.trip.origin = from;
              plan.trip.assumptions = [...plan.trip.assumptions, profile.homeCity?.trim() ? `Travelling from ${from}, your home city` : `Assumed you're travelling from ${from} (from your connection). Change it in Preferences`];
            }
          }
          // Signed in: keep this request in their history and remember the tastes they named.
          if (session && body.goal?.trim()) {
            const source = (plan.title ?? body.goal).trim();
            void Promise.all([
              saveSearch(session, { query: body.goal, mode: body.autonomy, title: plan.title ?? null, destination: plan.trip?.destination ?? null }),
              rememberTastes(session, [...(plan.trip?.likes ?? []), ...(plan.trip?.inspiredBy ? [plan.trip.inspiredBy] : [])], source),
            ]).catch((err) => console.warn("[mission] history save failed", err instanceof Error ? err.message : err));
          }
        }

        if (!prior && ctx.llm && plan.method === "keywords") console.warn(`[mission] the planning model didn't answer, so keywords were used (${plan.fallbackReason ?? "unknown reason"}). Run npm run check to test each model.`);
        const planner = { method: plan.method, fallbackReason: plan.fallbackReason ?? null };
        // Diagnostics stay on the server unless debug mode asked for them.
        plan = { ...plan, fallbackReason: null };
        sendDebug = () => {
          if (!debug) return;
          send("mission.debug", { planner, ...services(), logs, usage: ctx.usage.snapshot() });
        };
        // With a document, the agent can work out where and when itself.
        if (plan.mission === "plan" && !plan.trip && documents.length > 0) plan.trip = blankTrip(profile);
        if (plan.offTopic || (plan.mission === "plan" && !plan.trip) || (plan.mission !== "plan" && !plan.artist && !body.defaultArtist?.trim())) sendDebug();
        if (plan.offTopic) {
          send("mission.reply", { message: plan.reply ?? "I plan and book trips, stays, dinners and events, and I help artist teams with brand deals, tours and content.", suggestions: plan.suggestions, plan });
          return;
        }
        if (plan.mission === "plan" && !plan.trip) {
          send("mission.needs", {
            field: "destination",
            message: "Where to? Add when and for how many people if you know.",
            plan,
            preview: ["Find hotels, restaurants and venues that fit you", "Write a detailed plan with a budget", "Email, call and book for you once you approve"],
          });
          return;
        }
        if (plan.mission !== "plan" && !plan.artist && body.defaultArtist?.trim()) {
          try {
            plan.artist = normalizeArtistName(body.defaultArtist);
          } catch {
            /* ignore a bad remembered value */
          }
        }
        if (plan.mission !== "plan" && !plan.artist) {
          const preview = missionSteps(plan.mission).filter((st) => !st.id.startsWith("artist.") && !st.id.startsWith("fans.")).map((st) => st.title);
          send("mission.needs", { field: "artist", message: "Who's the artist? It can be you or someone you manage. I'll remember for next time.", plan, preview });
          return;
        }

        // A page refresh or a repeated request must not pay twice: look for a booking from the last few hours.
        let alreadyBooked: BriefInput["alreadyBooked"] = null;
        if (session && plan.mission === "plan" && !body.rebook) {
          alreadyBooked = await recentBooking(session, plan.goal).catch((err) => {
            console.warn("[mission] booking check failed", err instanceof Error ? err.message : err);
            return null;
          });
        }

        const selections = sanitizeSelections(plan.mission, body.selections);
        const pending = pendingCheckpoints(plan.mission, body.autonomy, selections);
        const def = MISSIONS[plan.mission];
        send("mission.planned", {
          runId,
          plan,
          goal:
            plan.mission === "plan"
              ? (plan.title ?? def.goal({ artist: "", destination: plan.trip?.destination, eventType: plan.trip?.event?.type }))
              : plan.title
                ? plan.title.replace(/\byour\b/i, `${plan.artist}'s`)
                : def.goal({ artist: plan.artist ?? "", focus: plan.focus, location: plan.location, compareWith: plan.compareWith, compareBrands: plan.compareBrands }),
          ack: plan.ack,
          autonomy: body.autonomy,
          steps: missionSteps(plan.mission),
          checkpoints: def.checkpoints.map((c) => ({ id: c.id, before: c.before, title: c.title })),
          resumed: Boolean(prior),
        });

        const skills = missionSkills(plan.mission);
        const input: BriefInput = {
          artist: plan.artist ?? "",
          trip: plan.trip ?? undefined,
          request: plan.goal,
          today: body.today,
          documents,
          profile,
          location: plan.location ?? undefined,
          focus: plan.focus ?? undefined,
          language: plan.language,
          compareWith: plan.compareWith ?? undefined,
          compareBrands: plan.compareBrands ?? undefined,
          selections,
          alreadyBooked,
        };
        const seed: Record<string, SkillResult<unknown>> = prior ? { ...prior.results } : {};
        // A new choice must re-run the checkpointed skill and everything downstream of it.
        for (const cp of def.checkpoints) {
          if (!selections[cp.id]) continue;
          const stale = new Set<string>([cp.before]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const s of skills) {
              if (stale.has(s.id)) continue;
              if ([...s.dependsOn, ...(s.optionalDeps ?? [])].some((d) => stale.has(d))) {
                stale.add(s.id);
                grew = true;
              }
            }
          }
          for (const id of stale) delete seed[id];
        }
        // Actions depend on the user's details, which they may have just filled in: always rebuild them.
        if (plan.mission === "plan") delete seed["trip.actions"];

        const run = await runBrief(skills, ctx, input, (e: BriefEvent) => send(e.type, e), { stopBefore: pending.map((c) => c.before), seed });
        saveRun(runId, plan, { ...seed, ...run.results });

        if (run.status === "waiting") {
          for (const cp of pending) {
            if (run.steps[cp.optionsFrom]?.status !== "succeeded") continue;
            send("mission.checkpoint", { id: cp.id, title: cp.title, hint: cp.hint, min: cp.min, max: cp.max, options: checkpointOptions(cp, run.results) });
          }
        }
        if (session && plan.mission === "plan" && run.status !== "waiting" && !alreadyBooked)
          await saveTripAndMemories(session, plan.goal, plan.title ?? plan.trip?.destination ?? "Your trip", { ...seed, ...run.results }).catch((err) => console.warn("[mission] trip save failed", err instanceof Error ? err.message : err));
        sendDebug();
        send("mission.completed", { status: run.status, steps: run.steps, ms: run.ms, usage: ctx.usage.snapshot() });
      } catch (err) {
        console.error("[mission] run failed", err instanceof Error ? err.message : err);
        if (debug) logs.push({ level: "error", msg: "Mission failed", meta: { error: err instanceof Error ? err.message : String(err) }, at: Date.now() - startedAt });
        sendDebug();
        send("mission.error", { error: "The mission couldn't run. Try again." });
      } finally {
        clearInterval(ping);
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** The city a request comes from, from the hosting edge's geolocation headers (Vercel). City level only. */
function cityFromRequest(req: Request): string | null {
  const h = req.headers;
  const dec = (v: string | null) => {
    if (!v) return "";
    try {
      return decodeURIComponent(v).trim();
    } catch {
      return v.trim();
    }
  };
  const city = dec(h.get("x-vercel-ip-city"));
  const country = dec(h.get("x-vercel-ip-country"));
  if (!city) return null;
  let countryName = country;
  try {
    countryName = country ? (new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country) : "";
  } catch {
    /* keep the code */
  }
  return [city, countryName].filter(Boolean).join(", ").slice(0, 80);
}
