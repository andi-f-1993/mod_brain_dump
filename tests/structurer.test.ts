import { expect, mock, test } from 'claude-code/testing'

const LONG = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ')
const composer = { origin: { kind: 'composer' }, wait: false } as const

const submit = ($: any, text: string) => $.prompt.submit({ text, ...composer } as any)

test('a long prompt gets the structuring instructions; a short one does not', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const short = await submit($, 'fix the typo in the README')
  expect(short.context ?? []).toEqual([])

  const long = await submit($, LONG)
  expect(long.text).toBe(LONG)
  expect((long.context ?? []).join('')).toContain('Definition of done')
})

test('raw: sends as is, structure: forces a short prompt', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const raw = await submit($, `raw: ${LONG}`)
  expect(raw.text).toBe(LONG)
  expect(raw.context ?? []).toEqual([])

  const forced = await submit($, 'structure: rename the flap module')
  expect(forced.text).toBe('rename the flap module')
  expect((forced.context ?? []).join('')).toContain('AskUserQuestion')
})

test('the ready tool fills the box without sending; the reviewed prompt then passes through', async ($, on) => {
  mock.store(on)
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: 0 } as any
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  await submit($, LONG)
  const prompt = '## Job\nDo X.\n## Why\nY.\n## Boundaries\nZ.\n## Definition of done\nTests pass.'
  const ran = await $.tool.call({ tool: 'mcp__brain-dump-structurer__ready', prompt } as any)
  expect(ran.deny).toBeUndefined()
  expect(typeof ran.result).toBe('string')
  expect(filled).toEqual([prompt])

  const reviewed = await submit($, prompt)
  expect(reviewed.context ?? []).toEqual([])
})

test('/brain-dump off turns detection off', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))

  const out = await $.command.run({ command: 'brain-dump', args: 'off' } as any)
  expect(out.text).toContain('off')
  const long = await submit($, LONG)
  expect(long.context ?? []).toEqual([])
})

test('a structuring that never reached the ready tool stops tagging prompts after two turns', async ($, on) => {
  mock.store(on)
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await submit($, LONG)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const answer = await submit($, 'option A please')
  expect((answer.context ?? []).join('')).toContain('continues the brain-dump')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const later = await submit($, 'an unrelated short question')
  expect(later.context ?? []).toEqual([])
})
