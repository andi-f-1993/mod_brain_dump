import type { Register } from 'claude-code'

// Long, unstructured prompts (voice brain dumps) are not acted on directly:
// Claude first turns them into a structured prompt, asks what is missing, and
// hands the result back into the prompt box for the person to review and send.

const TOOL = 'ready'
const TOOL_FULL = 'mcp__brain-dump-structurer__ready'
const ENABLED_KEY = 'enabled'

// "raw: ..." sends the prompt as is; "structure: ..." structures it whatever its length.
const RAW = /^\s*raw:\s*/i
const FORCE = /^\s*structure:\s*/i
const HEADINGS = ['## Job', '## Why', '## Boundaries', '## Definition of done']

const INSTRUCTIONS = `<brain-dump-structurer>
The user's message above is a long, unstructured brain dump (often voice input). Do NOT carry out the task it describes yet. Your only job this turn is to turn it into a clear, self-contained prompt the user will review and submit themselves.

Follow Anthropic's prompting guidance: be clear and direct, give the context and the reason behind each requirement, state constraints explicitly, and define what success looks like.

Steps:
1. Read the whole dump. Extract every concrete requirement, fact, file, name, number and preference. Drop filler, repetition and false starts; keep the user's own terms and technical vocabulary. Where the user corrected themselves, keep the corrected version.
2. If the project context (CLAUDE.md, the repository) answers a question, use it instead of asking. Read files only if needed to resolve ambiguity; make no changes.
3. Find the gaps that would materially change the result: an unclear goal, conflicting statements, a missing scope limit, no way to tell when it is done. Ask about those only, with the AskUserQuestion tool (up to 4 questions, concrete options, your recommended option first). Do not ask about things with a sensible default; state the default in the prompt as an assumption instead. If nothing material is missing, ask nothing.
4. Write the final prompt in the user's language, addressed to Claude, in this structure (omit "Context" if empty, never omit the others):

## Job
What to do, in one to three direct sentences, then the concrete steps or requirements as a list.
## Why
The goal behind it and who it is for, so trade-offs can be judged.
## Context
Relevant files, prior decisions, inputs, examples.
## Boundaries
What must not change, what is out of scope, constraints, when to stop and ask. Mark assumptions as "Assumption:".
## Definition of done
Checkable criteria: what exists, what is verified and how (tests, checks, numbers), what is reported back.

5. Call the ${TOOL_FULL} tool with the final prompt. It puts the prompt in the user's prompt box; it does not send it. Then reply in one short line: the prompt is ready to review and send. Do not start the work.
</brain-dump-structurer>`

const FOLLOW_UP = `<brain-dump-structurer>
This message continues the brain-dump structuring in progress (an answer to your clarifying questions, or more detail). Fold it into the structured prompt, then call ${TOOL_FULL} with the final prompt. Do not start the work.
</brain-dump-structurer>`

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
const isStructured = (text: string) => HEADINGS.every(h => text.includes(h))
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

export const register: Register = (on, options) => {
  const minWords = Number(options.minWords ?? 120)
  // Module variables: a hot reload resets them, which only re-arms detection.
  let lastFilled = ''
  let isPending = false
  // Turns a pending structuring may still span (the dump's turn and one answer to its questions).
  let pendingTurns = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brain-dump',
      description: 'Turn brain-dump structuring on or off (status without argument)',
      argumentHint: '[on|off]',
    })
    await $.tool.register({
      name: TOOL,
      description:
        'Puts the final structured prompt in the user\'s prompt box for review (does not send it). Call only when structuring a brain dump.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The final structured prompt, in Markdown.' },
        },
        required: ['prompt'],
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('command.run', { command: 'brain-dump' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await $.store.set(ENABLED_KEY, arg === 'on')
    }
    const isOn = (await $.store.get(ENABLED_KEY)) !== false

    return {
      text:
        `Brain-dump structuring is ${isOn ? 'on' : 'off'} (threshold ${minWords} words). ` +
        'Prefix a prompt with "raw:" to send it as is, or "structure:" to structure a short one.',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const fromPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (e.command || e.isMeta || !fromPerson) {
      return next(e)
    }
    if (RAW.test(e.text)) {
      return next({ ...e, text: e.text.replace(RAW, '') })
    }

    const isForced = FORCE.test(e.text)
    const text = isForced ? e.text.replace(FORCE, '') : e.text
    // The reviewed prompt coming back is what the person wants run.
    const isReviewed =
      (lastFilled !== '' && normalize(text) === normalize(lastFilled)) || isStructured(text)
    if (isReviewed) {
      isPending = false
      lastFilled = ''
      return next(e)
    }

    const context = e.context ?? []
    if (isPending) {
      return next({ ...e, text, context: [...context, FOLLOW_UP] })
    }

    const isOn = (await $.store.get(ENABLED_KEY)) !== false
    if (!isForced && (!isOn || words(text) < minWords)) {
      return next(e)
    }

    isPending = true
    pendingTurns = 2
    $.ui.status('Structuring brain dump…')

    return next({ ...e, text, context: [...context, INSTRUCTIONS] })
  })

  // A structuring that never reached the ready tool must not tag every later prompt as a follow-up.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && isPending && --pendingTurns <= 0) {
      isPending = false
      $.ui.status(undefined)
    }

    return next(e)
  })

  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    const prompt = String((e as { prompt?: unknown }).prompt ?? '').trim()
    if (prompt === '') {
      return { deny: 'The prompt is empty.' }
    }

    const filled = await $.prompt.fill({ text: prompt, mode: 'replace', cursor: 0 })
    lastFilled = prompt
    isPending = false
    $.ui.status(undefined)

    if (filled.isFilled) {
      $.ui.toast('Structured prompt is in the box: review, edit, then press Enter.')
      // An MCP-style tool answers with plain text: an object here is refused as the wrong shape.
      return {
        result:
          'The prompt is in the user\'s prompt box, not sent. Reply in one short line that it is ready to review and send; do not start the work.',
      }
    }

    return {
      result:
        'The prompt box could not be filled on this surface. Show the final prompt to the user in one fenced code block so they can copy it, and do not start the work.',
    }
  })
}
