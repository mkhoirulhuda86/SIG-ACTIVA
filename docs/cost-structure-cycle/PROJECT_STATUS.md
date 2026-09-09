# Update Cycle SAP — Project Status

Last updated: 2026-09-09

## Overall

```text
Foundation / specification        COMPLETE
Navigation + route shells         COMPLETE
Shared Cycle contracts            COMPLETE
CC master seed (59)               COMPLETE
Reference seed (45 August CC)     COMPLETE / governance status preserved
Parallel Codex prompts            COMPLETE
DB + ingestion                    READY FOR CODEX A
Allocation + validation engine    READY FOR CODEX B
Excel export + golden comparator  READY FOR CODEX C
Workflow/API/UI integration       WAITING FOR A+B+C
Production migration              NOT STARTED
```

## Locked business rules

- monthly input is one latest SAP cycle workbook containing both Fixed and Variable cycles;
- `7FT1GF` = Fixed Cost;
- `7VT1GF` = Variable Cost;
- one Receiver CC = one UI toggle;
- Segment never becomes an ON/OFF control;
- baseline CC is OFF only when every portion across both cycles is zero;
- ON → OFF sets all target rows/segments for that CC to zero;
- OFF → ON copies per-segment portion from configured current-cycle reference using exact Cycle + Segment name;
- target identity and SAP Start Date are preserved;
- no redistribution/normalization;
- generated output is delta only and split into Fixed/Variable SAP upload workbooks.

## Golden evidence

Validated real August scenario kept outside GitHub:

```text
Target CC     7203311054  Finish Mill 2 Tuban II
Reference CC  7203311053  Finish Mill 1 Tuban II
Baseline      target OFF
Result        target OFF → ON
Fixed parity  220 / 220 target segments
Var parity    214 / 214 target segments
```

This remains the mandatory private E2E release gate.

## Foundation files

```text
docs/cost-structure-cycle/*
lib/cost-structure/cycle/contracts.ts
app/cost-structure/cycle/page.tsx
app/cost-structure/cycle/history/page.tsx
app/cost-structure/cycle/master/page.tsx
lib/cost-structure/sidebar-navigation.ts
AGENTS.md
```

## Parallel work

Codex task prompts are stored in:

```text
docs/cost-structure-cycle/CODEX_PARALLEL_TASKS.md
```

Initial parallel lanes:

```text
A  Database + upload + storage + parser
B  Pure allocation + validation engine
C  Excel export + semantic golden comparator
```

Lane D integrates A+B+C only after their independent tests pass.

## Remote-build policy

All remaining work must follow `WORKING_POLICY.md`: collect changes, test them, and push coherent packages rather than incremental small changes. This is required to avoid unnecessary Vercel preview-build quota usage.

## Current remote branch note

The initial foundation was created through several small commits before the push policy was clarified. Do not continue that pattern. From this status onward, remote pushes must be batched.