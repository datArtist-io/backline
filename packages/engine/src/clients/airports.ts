// The main airports of the world's most travelled cities, by IATA code, so a fare can be asked for
// without another lookup. Several codes when a city has several airports (Google Flights searches all).
// Anything not here is looked up through the flight provider.
const AIRPORTS: Record<string, string[]> = {
  // Africa
  lagos: ["LOS"], abuja: ["ABV"], "port harcourt": ["PHC"], ibadan: ["IBA"], accra: ["ACC"], nairobi: ["NBO"], johannesburg: ["JNB"], "cape town": ["CPT"], cairo: ["CAI"], casablanca: ["CMN"], marrakech: ["RAK"], "addis ababa": ["ADD"], kigali: ["KGL"], dakar: ["DSS"], zanzibar: ["ZNZ"], "dar es salaam": ["DAR"], tunis: ["TUN"], abidjan: ["ABJ"], kampala: ["EBB"], durban: ["DUR"],
  // Europe
  london: ["LHR", "LGW", "STN", "LTN", "LCY"], paris: ["CDG", "ORY"], rome: ["FCO", "CIA"], milan: ["MXP", "LIN", "BGY"], madrid: ["MAD"], barcelona: ["BCN"], lisbon: ["LIS"], porto: ["OPO"], amsterdam: ["AMS"], berlin: ["BER"], munich: ["MUC"], frankfurt: ["FRA"], vienna: ["VIE"], zurich: ["ZRH"], geneva: ["GVA"], prague: ["PRG"], budapest: ["BUD"], athens: ["ATH"], istanbul: ["IST", "SAW"], dublin: ["DUB"], edinburgh: ["EDI"], manchester: ["MAN"], copenhagen: ["CPH"], stockholm: ["ARN"], oslo: ["OSL"], helsinki: ["HEL"], brussels: ["BRU"], venice: ["VCE"], florence: ["FLR"], naples: ["NAP"], nice: ["NCE"], seville: ["SVQ"], malaga: ["AGP"], reykjavik: ["KEF"], warsaw: ["WAW"], krakow: ["KRK"],
  // Middle East and Asia
  dubai: ["DXB", "DWC"], "abu dhabi": ["AUH"], doha: ["DOH"], riyadh: ["RUH"], jeddah: ["JED"], "tel aviv": ["TLV"], singapore: ["SIN"], tokyo: ["HND", "NRT"], osaka: ["KIX", "ITM"], kyoto: ["KIX", "ITM"], seoul: ["ICN", "GMP"], "hong kong": ["HKG"], shanghai: ["PVG", "SHA"], beijing: ["PEK", "PKX"], shenzhen: ["SZX"], guangzhou: ["CAN"], chongqing: ["CKG"], taipei: ["TPE"], bangkok: ["BKK", "DMK"], "kuala lumpur": ["KUL"], bali: ["DPS"], denpasar: ["DPS"], jakarta: ["CGK"], manila: ["MNL"], "ho chi minh city": ["SGN"], hanoi: ["HAN"], delhi: ["DEL"], "new delhi": ["DEL"], mumbai: ["BOM"], bangalore: ["BLR"], goa: ["GOI", "GOX"], colombo: ["CMB"], kathmandu: ["KTM"], male: ["MLE"], phuket: ["HKT"],
  // Americas
  "new york": ["JFK", "EWR", "LGA"], "los angeles": ["LAX"], "san francisco": ["SFO"], chicago: ["ORD", "MDW"], atlanta: ["ATL"], miami: ["MIA", "FLL"], boston: ["BOS"], washington: ["IAD", "DCA", "BWI"], houston: ["IAH", "HOU"], dallas: ["DFW", "DAL"], seattle: ["SEA"], "las vegas": ["LAS"], orlando: ["MCO"], "new orleans": ["MSY"], nashville: ["BNA"], austin: ["AUS"], denver: ["DEN"], philadelphia: ["PHL"], toronto: ["YYZ"], vancouver: ["YVR"], montreal: ["YUL"], "mexico city": ["MEX"], cancun: ["CUN"], havana: ["HAV"], "sao paulo": ["GRU", "CGH"], "rio de janeiro": ["GIG", "SDU"], "buenos aires": ["EZE", "AEP"], lima: ["LIM"], bogota: ["BOG"], cartagena: ["CTG"], santiago: ["SCL"], kingston: ["KIN"], honolulu: ["HNL"],
  // Oceania
  sydney: ["SYD"], melbourne: ["MEL"], brisbane: ["BNE"], perth: ["PER"], auckland: ["AKL"],
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** A city's airports by name ("Atlanta, GA" → ["ATL"]), or [] when it isn't a city we know. Pure. */
export function knownAirports(place: string): string[] {
  const city = fold(place.split(",")[0]);
  return AIRPORTS[city] ?? AIRPORTS[city.replace(/^(new|greater) /, "")] ?? [];
}
