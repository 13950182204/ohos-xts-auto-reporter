import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// 平台考试：题库 56 题（35 选择 + 21 判断），作答走 checkStatus/start/answer 三个接口。
// @ts-expect-error 纯 JS 模块，无类型声明
import {
  EXAM_TYPE_CHOICE,
  EXAM_TYPE_JUDGE,
  JUDGE_OPTIONS,
  buildExamIndex,
  loadExamBank,
  normalizeExamQuestion,
  normalizeQuestionText,
  parseExamAnswer,
  parseExamStart,
  parseExamStatus,
  resolveExamAnswer,
} from '../scripts/exam_logic.mjs'

const BANK_PATH = fileURLToPath(new URL('../scripts/exam_bank.json', import.meta.url))
// 题库文件里 type 是中文（选择题/判断题），平台接口返回的是 1/2，测试里做个映射。
const codeOf = (type: unknown) => (type === '选择题' ? EXAM_TYPE_CHOICE : EXAM_TYPE_JUDGE)
const bank = loadExamBank() as Array<Record<string, unknown>>
const index = buildExamIndex(bank)

describe('exam bank', () => {
  it('keeps all 56 questions with answers', () => {
    expect(bank).toHaveLength(56)
    const choice = bank.filter((item) => codeOf(item.type) === EXAM_TYPE_CHOICE)
    const judge = bank.filter((item) => codeOf(item.type) === EXAM_TYPE_JUDGE)
    expect(choice).toHaveLength(35)
    expect(judge).toHaveLength(21)
    for (const item of bank) {
      expect(String(item.question || '').length).toBeGreaterThan(4)
      expect(String(item.answerKey || '')).not.toBe('')
    }
  })

  it('ships the same bank that the CLI reads from disk', () => {
    const raw = JSON.parse(readFileSync(BANK_PATH, 'utf8'))
    expect(raw).toHaveLength(bank.length)
  })

  it('indexes every question by normalized text', () => {
    for (const item of bank) {
      const key = normalizeQuestionText(String(item.question))
      expect(index.get(key)).toBeTruthy()
    }
  })
})

describe('normalizeQuestionText', () => {
  it('ignores whitespace, zero-width characters and full-width punctuation', () => {
    const a = normalizeQuestionText('  以下，哪项 正确？ ')
    const b = normalizeQuestionText('以下,哪项正确?')
    expect(a).toBe(b)
  })
})

describe('normalizeExamQuestion', () => {
  it('normalizes choice options from label/content', () => {
    const question = normalizeExamQuestion({
      id: 'q1',
      type: EXAM_TYPE_CHOICE,
      content: bank[0].question,
      options: [
        { label: 'A', content: '选项一' },
        { label: 'B', content: '选项二' },
      ],
    })
    expect(question.options).toEqual([
      { key: 'A', text: '选项一' },
      { key: 'B', text: '选项二' },
    ])
  })

  it('falls back to 对/错 for judge questions without options', () => {
    const question = normalizeExamQuestion({
      id: 'q2',
      type: EXAM_TYPE_JUDGE,
      content: '判断题',
      options: [],
    })
    expect(question.options).toEqual(JUDGE_OPTIONS)
  })

  it('accepts key/text shaped options', () => {
    const question = normalizeExamQuestion({
      id: 'q3',
      type: EXAM_TYPE_JUDGE,
      content: '判断题',
      options: [
        { key: 'A', text: '正确' },
        { key: 'B', text: '错误' },
      ],
    })
    expect(question.options.map((option: { key: string }) => option.key)).toEqual(['A', 'B'])
  })
})

describe('resolveExamAnswer', () => {
  it('answers every banked question with the recorded key', () => {
    for (const item of bank) {
      const question = normalizeExamQuestion({
        id: `bank-${item.n}`,
        type: codeOf(item.type),
        content: item.question,
        options: item.options,
      })
      const resolved = resolveExamAnswer(question, index, bank)
      expect(resolved, `第 ${item.n} 题没有匹配上`).toBeTruthy()
      const matchedKey = resolved.answerKey
      const expectedKey = String(item.answerKey)
      expect(matchedKey).toBe(expectedKey)
    }
  })

  it('maps judge text answers to the fallback keys', () => {
    const judgeItem = bank.find((item) => codeOf(item.type) === EXAM_TYPE_JUDGE && String(item.answerText).includes('错'))
    expect(judgeItem).toBeTruthy()
    const question = normalizeExamQuestion({
      id: 'judge',
      type: EXAM_TYPE_JUDGE,
      content: judgeItem!.question,
      options: [],
    })
    expect(resolveExamAnswer(question, index, bank)?.answerKey).toBe('错')
  })

  it('still answers when the platform shuffles the options', () => {
    const item = bank.find((entry) => codeOf(entry.type) === EXAM_TYPE_CHOICE)
    expect(item).toBeTruthy()
    const reversed = [...(item!.options as Array<{ key: string; text: string }>)].reverse()
    const question = normalizeExamQuestion({
      id: 'shuffled',
      type: EXAM_TYPE_CHOICE,
      content: item!.question,
      options: reversed,
    })
    const resolved = resolveExamAnswer(question, index, bank)
    expect(resolved).toBeTruthy()
    // 选项被打乱后，返回的 key 必须是乱序后那个选项的 key（答案文本不变）。
    const target = question.options.find((option: { text: string }) => option.text === item!.answerText)
    expect(resolved!.answerKey).toBe(target?.key)
  })

  it('returns null for questions outside the bank', () => {
    const question = normalizeExamQuestion({
      id: 'unknown',
      type: EXAM_TYPE_CHOICE,
      content: '题库里没有这道题：____ 全对才通过？',
      options: [
        { label: 'A', content: '甲' },
        { label: 'B', content: '乙' },
      ],
    })
    expect(resolveExamAnswer(question, index, bank)).toBeNull()
  })
})

describe('platform payload parsing', () => {
  it('parses checkStatus', () => {
    expect(parseExamStatus({ code: 200, body: { canExam: true, lastExamTime: null } })).toMatchObject({
      ok: true,
      canExam: true,
    })
    expect(parseExamStatus({ code: 200, body: { canExam: false, lastExamTime: '2026-11-10 16:55:18' } })).toMatchObject({
      ok: true,
      canExam: false,
      lastExamTime: '2026-11-10 16:55:18',
    })
  })

  it('parses start and treats 10042 as not ok', () => {
    const started = parseExamStart({
      code: 200,
      body: { currentQuestion: { id: 'q1', type: 1, content: '题干', options: [{ label: 'A', content: '甲' }] }, currentIndex: 0, total: 56 },
    })
    expect(started.ok).toBe(true)
    expect(started.total).toBe(56)
    expect(started.question.options).toEqual([{ key: 'A', text: '甲' }])
    expect(parseExamStart({ code: 10042, msg: '24小时内无法重复参加考试' })).toMatchObject({ ok: false, code: 10042 })
  })

  it('parses an ended exam with the pass summary', () => {
    const parsed = parseExamAnswer({
      code: 200,
      body: { correct: true, examEnded: true, pass: true, correctCount: 56, total: 56, passMsg: '恭喜您通过考试、可开始兼容性测评申请' },
    })
    expect(parsed).toMatchObject({ ok: true, examEnded: true, pass: true, correctCount: 56, total: 56 })
    expect(parsed.resultMessage).toContain('恭喜')
  })

  it('parses the next question of an ongoing exam', () => {
    const parsed = parseExamAnswer({
      code: 200,
      body: { correct: false, correctAnswer: 'B', analysis: '解析', examEnded: false, nextQuestion: { id: 'q2', type: 2, content: '判断题', options: [] } },
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.examEnded).toBe(false)
    expect(parsed.nextQuestion.options).toEqual(JUDGE_OPTIONS)
  })
})
