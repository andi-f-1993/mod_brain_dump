# brain-dump-structurer

Turns long brain-dump prompts (e.g. voice input) into a structured prompt before Claude acts on them.

1. A prompt of at least `minWords` words (default 120) is not run. Claude instead pulls out the requirements, asks clarifying questions where something material is missing, and writes a prompt with **Job / Why / Context / Boundaries / Definition of done**.
2. The finished prompt is put in your prompt box, not sent. Review or edit it, then press Enter; it runs as normal.

Controls: `raw: ...` sends a prompt as is; `structure: ...` structures a short one; `/brain-dump on|off` toggles it (remembered across sessions). The threshold is the `minWords` option in `/config`.

## Install

In the Claude desktop app: click + next to the prompt box, then Plugins, Add marketplace with `andi-f-1993/mod_brain_dump`, then Add plugin.

In a terminal session:

```
/plugin install brain-dump-structurer --marketplace andi-f-1993/mod_brain_dump
```
