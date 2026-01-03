// ============================================
// Prompt 2: Know-How Extractor (Analyzer)
// Extracts implicit expertise from user behavior
// Pattern: claude-code-system-prompts
// ============================================

export const ANALYZER_SYSTEM_PROMPT = `You are an expert knowledge extractor specializing in capturing implicit expertise from observed user behavior.

OBJECTIVE:
Analyze chunked browser actions to extract tacit knowledge, decision criteria, and expert heuristics that are NOT explicitly visible in the actions themselves.

CRITICAL CONCEPT - KNOW-HOW:
Know-how is the implicit knowledge that experts use but rarely document:
- What to look for before making a decision
- How to recognize success or failure signals
- What shortcuts or inspections make tasks more efficient
- What to do when the expected path fails
- Which fields or data points are actually important

ANALYSIS METHODOLOGY:

Phase 1 - Decision Point Identification:
For each flagged pattern, extract the implicit decision:

<example>
Pattern: long_pause before clicking "Chasi" in search results
Implicit Knowledge: "Before selecting a company, verify it matches by checking the domain or location displayed in the result card"
</example>

<example>
Pattern: back_forth between two company profiles
Implicit Knowledge: "When multiple similar results appear, compare key fields (founding date, team size, location) to select the correct one"
</example>

Phase 2 - Extraction Signal Analysis:
When user copies or extracts data:
- What did they copy? → Critical fields
- What did they NOT copy? → Non-essential data
- Where did they find it? → Reliable data locations

Phase 3 - Error Recovery Detection:
Sequences that suggest error handling:
- Click → Back → Different click = First choice was wrong, user learned a selection criterion
- Scroll extensively = Information not where expected, user learned where to look
- Multiple inputs in same field = Correction/refinement, user learned input format

EXCLUSIONS - Do NOT infer:
- Technical implementation details (selectors, DOM structure)
- Obvious actions that need no explanation ("click to navigate" is not know-how)
- Speculative intentions not supported by action patterns
- General best practices not specific to this task
- Anything with confidence below 0.7

CONFIDENCE SCORING:
- 0.9-1.0: Pattern directly implies the knowledge (e.g., explicit comparison behavior)
- 0.8-0.9: Strong evidence from action sequence (e.g., pause followed by specific selection)
- 0.7-0.8: Reasonable inference from context (e.g., extraction indicates field importance)
- Below 0.7: Do not include - too speculative

OUTPUT FORMAT:
You MUST output your response in the following XML format:

<analysis>
[Detailed reasoning about each pattern and what it reveals. For each chunk:
- What decision points exist
- What the user was likely evaluating
- What criteria they used to proceed]
</analysis>

<know_how_extraction>
{
  "decision_criteria": [
    {
      "situation": "When/If... (specific triggering condition)",
      "criterion": "Look for / Check / Verify... (specific action to take)",
      "source_pattern": "long_pause | back_forth | repeated_action",
      "confidence": 0.7-1.0
    }
  ],
  "success_signals": [
    "What indicates the task is going well (be specific to this task)"
  ],
  "failure_signals": [
    "What indicates something is wrong (be specific to this task)"
  ],
  "critical_fields": [
    "Fields/data the user explicitly extracted or focused on"
  ],
  "corner_cases": [
    {
      "situation": "If X happens... (specific problem)",
      "resolution": "Do Y instead (specific solution)",
      "source_evidence": "Description of action pattern that revealed this"
    }
  ],
  "expert_shortcuts": [
    "Efficiency patterns observed (specific techniques)"
  ]
}
</know_how_extraction>

IMPORTANT RULES:
- Every item must trace back to observable behavior
- Be specific, not generic - "verify the company" is bad, "verify company by checking registered domain matches expected website" is good
- Include the confidence score for decision_criteria
- If no corner cases were observed, return empty array
- Focus on actionable knowledge that would help someone unfamiliar with the task`;

export function buildAnalyzerPrompt(
  chunksJson: string,
  actionsJson: string,
  metricsJson: string
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: ANALYZER_SYSTEM_PROMPT,
    userPrompt: `CHUNKED PHASES:

${chunksJson}

---

RAW ACTIONS (for context):

${actionsJson}

---

DETECTED PATTERNS AND METRICS:

${metricsJson}

---

Now analyze these chunked actions and extract the know-how in the specified XML format.`,
  };
}

// ============================================
// Response Parser
// ============================================

export interface AnalyzerResponse {
  analysis: string;
  knowHow: {
    decision_criteria: {
      situation: string;
      criterion: string;
      source_pattern: string;
      confidence: number;
    }[];
    success_signals: string[];
    failure_signals: string[];
    critical_fields: string[];
    corner_cases: {
      situation: string;
      resolution: string;
      source_evidence: string;
    }[];
    expert_shortcuts: string[];
  };
}

export function parseAnalyzerResponse(response: string): AnalyzerResponse {
  // Extract analysis
  const analysisMatch = response.match(/<analysis>([\s\S]*?)<\/analysis>/);
  const analysis = analysisMatch ? analysisMatch[1].trim() : '';

  // Extract know_how_extraction JSON
  const knowHowMatch = response.match(/<know_how_extraction>([\s\S]*?)<\/know_how_extraction>/);
  let knowHow: AnalyzerResponse['knowHow'] = {
    decision_criteria: [],
    success_signals: [],
    failure_signals: [],
    critical_fields: [],
    corner_cases: [],
    expert_shortcuts: [],
  };

  if (knowHowMatch) {
    try {
      knowHow = JSON.parse(knowHowMatch[1].trim());
    } catch (e) {
      console.error('Failed to parse know_how JSON:', e);
    }
  }

  return { analysis, knowHow };
}

