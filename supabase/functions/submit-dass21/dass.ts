// Shared DASS-21 logic. Imported by the React app AND the Supabase Edge Function,
// so the on-screen results, the PDF and the email always say the same thing.
// Keep this file dependency-free.

export const ITEMS: string[] = [
  "I found it hard to wind down",
  "I was aware of dryness of my mouth",
  "I could not seem to experience any positive feeling at all",
  "I experienced breathing difficulty (e.g. in the absence of physical exertion)",
  "I found it difficult to work up the initiative to do things",
  "I tended to over-react to situations",
  "I experienced trembling (e.g. in the hands)",
  "I felt that I was using a lot of nervous energy",
  "I was worried about situations in which I might panic and make a fool of myself",
  "I felt that I had nothing to look forward to",
  "I found myself getting agitated",
  "I found it difficult to relax",
  "I felt down-hearted and blue",
  "I was intolerant of anything that kept me from getting on with what I was doing",
  "I felt I was close to panic",
  "I was unable to become enthusiastic about anything",
  "I felt I was not worth much as a person",
  "I felt that I was rather touchy",
  "I was aware of the action of my heart in the absence of physical exertion (e.g. sense of heart rate increase, heart missing a beat)",
  "I felt scared without any good reason",
  "I felt that life was meaningless",
];

export const SCALE_OPTIONS = [
  { value: 0, label: "Did not apply to me at all" },
  { value: 1, label: "Applied to me to some degree, or some of the time" },
  { value: 2, label: "Applied to me to a considerable degree, or a good part of the time" },
  { value: 3, label: "Applied to me very much, or most of the time" },
] as const;

export type ScaleKey = "depression" | "anxiety" | "stress";
export const SCALE_KEYS: ScaleKey[] = ["depression", "anxiety", "stress"];
export const SCALE_NAMES: Record<ScaleKey, string> = {
  depression: "Depression",
  anxiety: "Anxiety",
  stress: "Stress",
};

// 1-based item numbers, exactly as specified
export const SUBSCALE_ITEMS: Record<ScaleKey, number[]> = {
  depression: [3, 5, 10, 13, 16, 17, 21],
  anxiety: [2, 4, 7, 9, 15, 19, 20],
  stress: [1, 6, 8, 11, 12, 14, 18],
};

export const SEVERITIES = ["Normal", "Mild", "Moderate", "Severe", "Extremely Severe"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Lower bound (inclusive) of each band, on the doubled 0-42 score.
const BAND_MINS: Record<ScaleKey, [number, number, number, number, number]> = {
  depression: [0, 10, 14, 21, 28],
  anxiety: [0, 8, 10, 15, 20],
  stress: [0, 15, 19, 26, 34],
};

export function severityFor(scale: ScaleKey, doubled: number): Severity {
  const mins = BAND_MINS[scale];
  let idx = 0;
  for (let i = 0; i < mins.length; i++) if (doubled >= mins[i]) idx = i;
  return SEVERITIES[idx];
}

export function isValidAnswers(a: unknown): a is number[] {
  return (
    Array.isArray(a) &&
    a.length === 21 &&
    a.every((v) => Number.isInteger(v) && v >= 0 && v <= 3)
  );
}

export interface ScaleResult {
  key: ScaleKey;
  name: string;
  raw: number; // 0-21
  score: number; // doubled, 0-42
  severity: Severity;
  level: number; // 0 Normal .. 4 Extremely Severe
}

export interface DassResult {
  scales: Record<ScaleKey, ScaleResult>;
}

export function scoreDass(answers: number[]): DassResult {
  if (!isValidAnswers(answers)) throw new Error("Expected 21 answers, each an integer 0-3");
  const scales = {} as Record<ScaleKey, ScaleResult>;
  for (const key of SCALE_KEYS) {
    const raw = SUBSCALE_ITEMS[key].reduce((sum, n) => sum + answers[n - 1], 0);
    const score = raw * 2;
    const severity = severityFor(key, score);
    scales[key] = {
      key,
      name: SCALE_NAMES[key],
      raw,
      score,
      severity,
      level: SEVERITIES.indexOf(severity),
    };
  }
  return { scales };
}

// ---------------------------------------------------------------------------
// Plain-English content (shared by screen, PDF and email)
// ---------------------------------------------------------------------------

export const SCALE_MEANING: Record<ScaleKey, string> = {
  depression:
    "The Depression scale looks at low mood, loss of interest or enjoyment, low motivation, hopelessness and a sense of low self-worth over the past week.",
  anxiety:
    "The Anxiety scale looks at physical signs of arousal (such as a racing heart, dry mouth or trembling), feelings of panic, and fear that seems out of proportion to the situation.",
  stress:
    "The Stress scale looks at ongoing tension: difficulty relaxing, being easily upset or irritable, impatience, and feeling 'on edge' or using a lot of nervous energy.",
};

const LEVEL_TEXT: Record<Severity, string> = {
  Normal:
    "Your score is in the normal range. This suggests these experiences were not a significant issue for you over the past week.",
  Mild:
    "Your score is in the mild range. This suggests you noticed some of these experiences over the past week. Many people move in and out of this range during busy or difficult periods, and small changes in routine can help.",
  Moderate:
    "Your score is in the moderate range. This suggests these experiences were noticeable for a good part of the past week and may be affecting how you feel day to day. It is worth paying attention to, and talking to someone you trust or a professional could help.",
  Severe:
    "Your score is in the severe range. This suggests these experiences were strong and frequent over the past week. We encourage you to speak with a GP, counsellor or mental health professional, who can help you understand what is going on and what support may help.",
  "Extremely Severe":
    "Your score is in the extremely severe range. This suggests these experiences were very intense over the past week. Please consider reaching out to a GP, counsellor or mental health professional soon. If you feel unsafe or overwhelmed, use the help resources listed in this report.",
};

const SUGGESTIONS: Record<ScaleKey, string[]> = {
  depression: [
    "Keep a simple daily routine: regular wake-up time, meals and one small planned activity you usually enjoy.",
    "Get some movement in most days, even a 10-20 minute walk outdoors.",
    "Stay connected: message or meet one person you trust and let them know how you have been feeling.",
    "Break tasks into very small steps and notice each one you complete.",
  ],
  anxiety: [
    "Try slow breathing when you notice physical symptoms: breathe in for 4 counts and out for 6, for a few minutes.",
    "Cut back on caffeine and alcohol, which can make physical anxiety symptoms stronger.",
    "Protect your sleep with a regular bedtime and less screen time in the hour before bed.",
    "Talk to someone about what worries you, rather than handling it alone.",
  ],
  stress: [
    "Look at your current load and pick one thing you can drop, delay or delegate this week.",
    "Build short breaks into your day and step away from screens during them.",
    "Use regular physical activity to release tension, such as walking, cycling or stretching.",
    "Keep a consistent sleep schedule and a wind-down routine before bed.",
  ],
};

export interface ScaleAnalysis {
  meaning: string;
  levelText: string;
  suggestions: string[]; // empty when Normal
}

export function analyseScale(r: ScaleResult): ScaleAnalysis {
  return {
    meaning: SCALE_MEANING[r.key],
    levelText: LEVEL_TEXT[r.severity],
    suggestions: r.level > 0 ? SUGGESTIONS[r.key] : [],
  };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

export function overallSummary(result: DassResult): string {
  const list = SCALE_KEYS.map((k) => result.scales[k]);
  const elevated = list.filter((s) => s.level > 0);

  if (elevated.length === 0) {
    return "All three of your scores are in the normal range. This suggests that depression, anxiety and stress were not significant concerns for you over the past week. Keep doing what supports you, such as good sleep, movement and staying connected with others.";
  }

  // Highest = highest severity level; ties broken by doubled score.
  const maxLevel = Math.max(...list.map((s) => s.level));
  const top = list.filter((s) => s.level === maxLevel);
  const topNames = top.map((s) => s.name);
  const topSeverity = top[0].severity.toLowerCase();

  let text: string;
  if (top.length === 1) {
    text = `Your most elevated area is ${top[0].name} (${top[0].severity}).`;
  } else {
    text = `${joinNames(topNames)} are your most elevated areas, both in the ${topSeverity} range.`;
    if (top.length === 3) text = `All three areas are at the same level (${top[0].severity}).`;
  }

  const others = elevated.filter((s) => s.level < maxLevel);
  if (others.length) {
    text += ` ${joinNames(others.map((s) => `${s.name} (${s.severity})`))} ${others.length === 1 ? "is" : "are"} also above the normal range.`;
  }

  if (elevated.length === 3) {
    text +=
      " All three scales are above the normal range, which suggests the past week has been a difficult one on several fronts. It can help to focus first on the basics: sleep, regular meals, some movement and talking to someone you trust.";
  } else {
    const normal = list.filter((s) => s.level === 0).map((s) => s.name);
    text += ` ${joinNames(normal)} ${normal.length === 1 ? "is" : "are"} in the normal range.`;
  }

  if (maxLevel >= 3) {
    text +=
      " Because at least one score is in the severe range or higher, we encourage you to speak with a GP, counsellor or mental health professional.";
  } else {
    text +=
      " Scores like these often change with circumstances. If these feelings continue or get worse, talking to a professional is a good next step.";
  }
  text += " Reaching out for support is a sign of strength, not weakness.";
  return text;
}

export const DISCLAIMER =
  "This is a screening tool only, not a diagnosis. If you are struggling, please speak to a GP, counsellor or mental health professional.";

export const HELP_RESOURCES: { name: string; detail: string }[] = [
  { name: "Samaritans of Singapore (SOS)", detail: "1767 (24-hour)" },
  { name: "IMH Mental Health Helpline", detail: "6389 2222" },
  { name: "National CARE Hotline", detail: "1800-202-6868" },
  { name: "If you are in immediate danger", detail: "call 995" },
];
