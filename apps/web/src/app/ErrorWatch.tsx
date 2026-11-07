"use client";
import { useEffect } from "react";
import { watchErrors } from "@/lib/errors";

/** Mounted once in the root layout: browser errors reach the server's log. Renders nothing. */
export default function ErrorWatch() {
  useEffect(() => watchErrors(), []);
  return null;
}
