const LOCAL_LOCATION_CATALOG = [
  "New York, United States",
  "Los Angeles, United States",
  "Chicago, United States",
  "Houston, United States",
  "Phoenix, United States",
  "Philadelphia, United States",
  "San Antonio, United States",
  "San Diego, United States",
  "Dallas, United States",
  "San Jose, United States",
  "Austin, United States",
  "Jacksonville, United States",
  "Fort Worth, United States",
  "Columbus, United States",
  "Charlotte, United States",
  "San Francisco, United States",
  "Indianapolis, United States",
  "Seattle, United States",
  "Denver, United States",
  "Washington, United States",
  "Boston, United States",
  "Nashville, United States",
  "Las Vegas, United States",
  "Miami, United States",
  "Atlanta, United States",
  "Toronto, Canada",
  "Vancouver, Canada",
  "Montreal, Canada",
  "London, United Kingdom",
  "Manchester, United Kingdom",
  "Birmingham, United Kingdom",
  "Paris, France",
  "Berlin, Germany",
  "Munich, Germany",
  "Madrid, Spain",
  "Barcelona, Spain",
  "Rome, Italy",
  "Milan, Italy",
  "Amsterdam, Netherlands",
  "Brussels, Belgium",
  "Zurich, Switzerland",
  "Vienna, Austria",
  "Stockholm, Sweden",
  "Oslo, Norway",
  "Copenhagen, Denmark",
  "Dublin, Ireland",
  "Lisbon, Portugal",
  "Prague, Czechia",
  "Warsaw, Poland",
  "Athens, Greece",
  "Istanbul, Turkey",
  "Ankara, Turkey",
  "Baku, Azerbaijan",
  "Dubai, United Arab Emirates",
  "Abu Dhabi, United Arab Emirates",
  "Doha, Qatar",
  "Riyadh, Saudi Arabia",
  "Cairo, Egypt",
  "Cape Town, South Africa",
  "Johannesburg, South Africa",
  "Lagos, Nigeria",
  "Nairobi, Kenya",
  "Mumbai, India",
  "Delhi, India",
  "Bengaluru, India",
  "Hyderabad, India",
  "Karachi, Pakistan",
  "Lahore, Pakistan",
  "Dhaka, Bangladesh",
  "Bangkok, Thailand",
  "Singapore",
  "Kuala Lumpur, Malaysia",
  "Jakarta, Indonesia",
  "Manila, Philippines",
  "Hong Kong",
  "Taipei, Taiwan",
  "Tokyo, Japan",
  "Osaka, Japan",
  "Seoul, South Korea",
  "Beijing, China",
  "Shanghai, China",
  "Shenzhen, China",
  "Sydney, Australia",
  "Melbourne, Australia",
  "Brisbane, Australia",
  "Auckland, New Zealand",
  "Sao Paulo, Brazil",
  "Rio de Janeiro, Brazil",
  "Buenos Aires, Argentina",
  "Santiago, Chile",
  "Bogota, Colombia",
  "Lima, Peru",
  "Mexico City, Mexico",
  "Monterrey, Mexico",
  "Guadalajara, Mexico",
];

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  suburb?: string;
  county?: string;
  state?: string;
  region?: string;
  country?: string;
};

type NominatimResult = {
  address?: NominatimAddress;
  display_name?: string;
};

function normalizeLocationPart(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function getPartKey(value: string) {
  return value.toLocaleLowerCase();
}

export function normalizeLocationLabel(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  const uniqueParts: string[] = [];

  for (const part of parts) {
    const normalizedPart = normalizeLocationPart(part);
    if (!normalizedPart) {
      continue;
    }

    const key = getPartKey(normalizedPart);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueParts.push(normalizedPart);
  }

  return uniqueParts.join(", ");
}

function normalizeStoredLabel(label: string) {
  return normalizeLocationLabel(label.split(","));
}

function dedupeSuggestions(items: string[]) {
  const uniqueByKey = new Map<string, string>();

  for (const item of items) {
    const normalizedItem = normalizeStoredLabel(item);
    if (!normalizedItem) {
      continue;
    }

    const key = getPartKey(normalizedItem);
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, normalizedItem);
    }
  }

  return [...uniqueByKey.values()];
}

function scoreLocationSuggestion(candidate: string, query: string) {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (normalizedCandidate === normalizedQuery) {
    return 0;
  }

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 1;
  }

  const wordIndex = normalizedCandidate.indexOf(` ${normalizedQuery}`);
  if (wordIndex >= 0) {
    return 2 + wordIndex;
  }

  const includesIndex = normalizedCandidate.indexOf(normalizedQuery);
  if (includesIndex >= 0) {
    return 100 + includesIndex;
  }

  return Number.POSITIVE_INFINITY;
}

function getPrimaryPlaceName(address: NominatimAddress) {
  return (
    address.city
    || address.town
    || address.village
    || address.municipality
    || address.hamlet
    || address.suburb
    || address.county
    || address.state
    || address.region
    || address.country
    || ""
  );
}

function formatNominatimResult(result: NominatimResult) {
  const address = result.address;
  if (!address) {
    return normalizeStoredLabel(result.display_name ?? "");
  }

  const primary = getPrimaryPlaceName(address);
  return normalizeLocationLabel([primary, address.country]);
}

async function searchNominatim(query: string, signal?: AbortSignal, limit = 6) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`,
    {
      signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
      },
    }
  );

  if (!response.ok) {
    return [];
  }

  const results = (await response.json()) as NominatimResult[];
  return results.map(formatNominatimResult).filter(Boolean);
}

export function getLocalLocationSuggestions(query: string, limit = 6) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return [];
  }

  return LOCAL_LOCATION_CATALOG
    .map((candidate) => ({
      candidate: normalizeStoredLabel(candidate),
      score: scoreLocationSuggestion(candidate, normalizedQuery),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return left.candidate.localeCompare(right.candidate);
    })
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

export async function searchLocationSuggestions(query: string, signal?: AbortSignal, limit = 6) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return [];
  }

  const localMatches = getLocalLocationSuggestions(normalizedQuery, limit);

  try {
    const nominatimMatches = await searchNominatim(normalizedQuery, signal, limit);
    return dedupeSuggestions([...nominatimMatches, ...localMatches]).slice(0, limit);
  } catch {
    return localMatches;
  }
}
