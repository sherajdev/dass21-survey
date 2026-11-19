import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { scoreDass, severityFor, SUBSCALE_ITEMS, overallSummary, ITEMS } from "../supabase/functions/submit-dass21/dass.ts";
import { buildPdf, buildEmail } from "../supabase/functions/submit-dass21/report.ts";

// Build an answer set that gives the requested raw subscale totals.
function answersFor(raw: { depression: number; anxiety: number; stress: number }): number[] {
  const a = new Array(21).fill(0);
  for (const key of ["depression", "anxiety", "stress"] as const) {
    let left = raw[key];
    for (const n of SUBSCALE_ITEMS[key]) {
      const v = Math.min(3, left);
      a[n - 1] = v;
      left -= v;
    }
    if (left !== 0) throw new Error("raw too high");
  }
  return a;
}

describe("DASS-21 scoring", () => {
  it("has 21 items and each item belongs to exactly one subscale", () => {
    expect(ITEMS).toHaveLength(21);
    const all = [...SUBSCALE_ITEMS.depression, ...SUBSCALE_ITEMS.anxiety, ...SUBSCALE_ITEMS.stress].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("all 0s = Normal on all three scales", () => {
    const r = scoreDass(new Array(21).fill(0));
    for (const s of Object.values(r.scales)) {
      expect(s.score).toBe(0);
      expect(s.severity).toBe("Normal");
    }
  });

  it("known case: raw D6 A7 S11 -> 12 Mild, 14 Moderate, 22 Moderate", () => {
    const r = scoreDass(answersFor({ depression: 6, anxiety: 7, stress: 11 }));
    expect(r.scales.depression).toMatchObject({ raw: 6, score: 12, severity: "Mild" });
    expect(r.scales.anxiety).toMatchObject({ raw: 7, score: 14, severity: "Moderate" });
    expect(r.scales.stress).toMatchObject({ raw: 11, score: 22, severity: "Moderate" });
  });

  it("all 3s = 42 Extremely Severe everywhere", () => {
    const r = scoreDass(new Array(21).fill(3));
    for (const s of Object.values(r.scales)) {
      expect(s.score).toBe(42);
      expect(s.severity).toBe("Extremely Severe");
    }
  });

  it("uses the right items per subscale (x2 multiplication)", () => {
    const a = new Array(21).fill(0);
    a[2] = 3; // item 3 -> depression
    a[1] = 2; // item 2 -> anxiety
    a[0] = 1; // item 1 -> stress
    const r = scoreDass(a);
    expect(r.scales.depression.score).toBe(6);
    expect(r.scales.anxiety.score).toBe(4);
    expect(r.scales.stress.score).toBe(2);
  });

  it("band boundaries match the spec exactly", () => {
    const cases: [Parameters<typeof severityFor>[0], number, string][] = [
      ["depression", 9, "Normal"], ["depression", 10, "Mild"], ["depression", 13, "Mild"], ["depression", 14, "Moderate"],
      ["depression", 20, "Moderate"], ["depression", 21, "Severe"], ["depression", 27, "Severe"], ["depression", 28, "Extremely Severe"],
      ["anxiety", 7, "Normal"], ["anxiety", 8, "Mild"], ["anxiety", 9, "Mild"], ["anxiety", 10, "Moderate"],
      ["anxiety", 14, "Moderate"], ["anxiety", 15, "Severe"], ["anxiety", 19, "Severe"], ["anxiety", 20, "Extremely Severe"],
      ["stress", 14, "Normal"], ["stress", 15, "Mild"], ["stress", 18, "Mild"], ["stress", 19, "Moderate"],
      ["stress", 25, "Moderate"], ["stress", 26, "Severe"], ["stress", 33, "Severe"], ["stress", 34, "Extremely Severe"],
    ];
    for (const [scale, score, sev] of cases) expect(severityFor(scale, score), `${scale} ${score}`).toBe(sev);
  });

  it("rejects incomplete or out-of-range answers", () => {
    expect(() => scoreDass(new Array(20).fill(0))).toThrow();
    expect(() => scoreDass([...new Array(20).fill(0), 4])).toThrow();
    expect(() => scoreDass([...new Array(20).fill(0), 1.5])).toThrow();
  });
});

describe("summary, PDF and email", () => {
  const result = scoreDass(answersFor({ depression: 6, anxiety: 7, stress: 11 }));
  const input = { name: "Test <User>", email: "t@example.com", date: new Date("2026-11-19T04:00:00Z"), result };

  it("summary names the highest scale", () => {
    expect(overallSummary(result)).toMatch(/Anxiety and Stress are your most elevated areas/);
    expect(overallSummary(scoreDass(new Array(21).fill(0)))).toMatch(/All three of your scores are in the normal range/);
    expect(overallSummary(scoreDass(new Array(21).fill(3)))).toMatch(/All three scales are above the normal range/);
  });

  it("builds a non-empty PDF", () => {
    const doc = buildPdf(jsPDF, input);
    const bytes = doc.output("arraybuffer") as ArrayBuffer;
    expect(bytes.byteLength).toBeGreaterThan(3000);
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5))).toBe("%PDF-");
  });

  it("email escapes HTML and includes disclaimer + resources", () => {
    const m = buildEmail(input);
    expect(m.subject).toBe("Your DASS-21 Results - Test <User>");
    expect(m.html).toContain("Test &lt;User&gt;");
    expect(m.html).not.toContain("Test <User>");
    expect(m.text).toContain("This is a screening tool only, not a diagnosis.");
    expect(m.text).toContain("1767 (24-hour)");
    expect(m.text).toContain("call 995");
  });
});
