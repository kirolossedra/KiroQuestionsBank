import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  type CategoryDetail,
  type CategorySummary,
  type Question,
  type QuestionOption,
  type QuestionType,
  type Subcategory,
  validateCategoryImport,
  validateQuestion,
} from '../shared/contracts'

type D1Value = string | number | null

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
}

type Bindings = { DB: D1Database }

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

const nowIso = () => new Date().toISOString()
const id = () => crypto.randomUUID()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredText = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value.trim()
}

const optionalText = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null`)
  return value.trim() || null
}

async function readCategory(db: D1Database, categoryId: string): Promise<CategoryDetail | null> {
  const category = await db
    .prepare('SELECT id, name, description, created_at, updated_at FROM categories WHERE id = ?')
    .bind(categoryId)
    .first<{ id: string; name: string; description: string | null; created_at: string; updated_at: string }>()

  if (!category) return null

  const [subcategoriesResult, questionsResult, optionsResult] = await Promise.all([
    db
      .prepare('SELECT id, category_id, name, description FROM subcategories WHERE category_id = ? ORDER BY position, created_at')
      .bind(categoryId)
      .all<{ id: string; category_id: string; name: string; description: string | null }>(),
    db
      .prepare(`
        SELECT q.id, q.subcategory_id, q.type, q.body_markdown, q.explanation_markdown
        FROM questions q
        JOIN subcategories s ON s.id = q.subcategory_id
        WHERE s.category_id = ?
        ORDER BY s.position, q.position, q.created_at
      `)
      .bind(categoryId)
      .all<{
        id: string
        subcategory_id: string
        type: QuestionType
        body_markdown: string
        explanation_markdown: string | null
      }>(),
    db
      .prepare(`
        SELECT o.id, o.question_id, o.body_markdown, o.is_correct
        FROM question_options o
        JOIN questions q ON q.id = o.question_id
        JOIN subcategories s ON s.id = q.subcategory_id
        WHERE s.category_id = ?
        ORDER BY s.position, q.position, o.position
      `)
      .bind(categoryId)
      .all<{ id: string; question_id: string; body_markdown: string; is_correct: number }>(),
  ])

  const optionsByQuestion = new Map<string, QuestionOption[]>()
  for (const row of optionsResult.results) {
    const option: QuestionOption = {
      id: row.id,
      bodyMarkdown: row.body_markdown,
      correct: row.is_correct === 1,
    }
    const current = optionsByQuestion.get(row.question_id) ?? []
    current.push(option)
    optionsByQuestion.set(row.question_id, current)
  }

  const questionsBySubcategory = new Map<string, Question[]>()
  for (const row of questionsResult.results) {
    const question: Question = {
      id: row.id,
      type: row.type,
      bodyMarkdown: row.body_markdown,
      explanationMarkdown: row.explanation_markdown,
      options: optionsByQuestion.get(row.id) ?? [],
    }
    const current = questionsBySubcategory.get(row.subcategory_id) ?? []
    current.push(question)
    questionsBySubcategory.set(row.subcategory_id, current)
  }

  const subcategories: Subcategory[] = subcategoriesResult.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    questions: questionsBySubcategory.get(row.id) ?? [],
  }))

  return {
    id: category.id,
    name: category.name,
    description: category.description,
    createdAt: category.created_at,
    updatedAt: category.updated_at,
    subcategories,
  }
}

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/categories', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.created_at,
      (SELECT COUNT(*) FROM subcategories s WHERE s.category_id = c.id) AS subcategory_count,
      (
        SELECT COUNT(*)
        FROM questions q
        JOIN subcategories s ON s.id = q.subcategory_id
        WHERE s.category_id = c.id
      ) AS question_count
    FROM categories c
    ORDER BY c.updated_at DESC, c.created_at DESC
  `).all<{
    id: string
    name: string
    description: string | null
    created_at: string
    subcategory_count: number
    question_count: number
  }>()

  const categories: CategorySummary[] = results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    subcategoryCount: Number(row.subcategory_count),
    questionCount: Number(row.question_count),
    createdAt: row.created_at,
  }))

  return c.json({ categories })
})

app.post('/api/categories', async (c) => {
  const payload: unknown = await c.req.json()
  if (!isRecord(payload)) return c.json({ error: 'Request body must be an object' }, 400)

  try {
    const categoryId = id()
    const name = requiredText(payload.name, 'name')
    const description = optionalText(payload.description, 'description')
    await c.env.DB.prepare('INSERT INTO categories (id, name, description) VALUES (?, ?, ?)')
      .bind(categoryId, name, description)
      .run()
    return c.json({ id: categoryId }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid category' }, 400)
  }
})

app.get('/api/categories/:id', async (c) => {
  const category = await readCategory(c.env.DB, c.req.param('id'))
  return category ? c.json({ category }) : c.json({ error: 'Category not found' }, 404)
})

app.post('/api/categories/:id/subcategories', async (c) => {
  const categoryId = c.req.param('id')
  const payload: unknown = await c.req.json()
  if (!isRecord(payload)) return c.json({ error: 'Request body must be an object' }, 400)

  try {
    const name = requiredText(payload.name, 'name')
    const description = optionalText(payload.description, 'description')
    const category = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first()
    if (!category) return c.json({ error: 'Category not found' }, 404)

    const next = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM subcategories WHERE category_id = ?',
    )
      .bind(categoryId)
      .first<{ position: number }>()

    const subcategoryId = id()
    await c.env.DB.batch([
      c.env.DB
        .prepare('INSERT INTO subcategories (id, category_id, name, description, position) VALUES (?, ?, ?, ?, ?)')
        .bind(subcategoryId, categoryId, name, description, Number(next?.position ?? 0)),
      c.env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(nowIso(), categoryId),
    ])

    return c.json({ id: subcategoryId }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid subcategory' }, 400)
  }
})

app.post('/api/subcategories/:id/questions', async (c) => {
  const subcategoryId = c.req.param('id')

  try {
    const question = validateQuestion(await c.req.json())
    const subcategory = await c.env.DB
      .prepare('SELECT id, category_id FROM subcategories WHERE id = ?')
      .bind(subcategoryId)
      .first<{ id: string; category_id: string }>()
    if (!subcategory) return c.json({ error: 'Subcategory not found' }, 404)

    const next = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM questions WHERE subcategory_id = ?',
    )
      .bind(subcategoryId)
      .first<{ position: number }>()

    const questionId = id()
    const statements: D1PreparedStatement[] = [
      c.env.DB
        .prepare(
          'INSERT INTO questions (id, subcategory_id, type, body_markdown, explanation_markdown, position) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          questionId,
          subcategoryId,
          question.type,
          question.bodyMarkdown,
          question.explanationMarkdown ?? null,
          Number(next?.position ?? 0),
        ),
      ...question.options.map((option, index) =>
        c.env.DB
          .prepare(
            'INSERT INTO question_options (id, question_id, body_markdown, is_correct, position) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(id(), questionId, option.bodyMarkdown, option.correct ? 1 : 0, index),
      ),
      c.env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(nowIso(), subcategory.category_id),
    ]

    await c.env.DB.batch(statements)
    return c.json({ id: questionId }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid question' }, 400)
  }
})

app.delete('/api/categories/:id', async (c) => {
  const categoryId = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first()
  if (!existing) return c.json({ error: 'Category not found' }, 404)

  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run()
  return c.body(null, 204)
})

app.get('/api/categories/:id/export', async (c) => {
  const category = await readCategory(c.env.DB, c.req.param('id'))
  if (!category) return c.json({ error: 'Category not found' }, 404)

  const exportFile = {
    schemaVersion: 1 as const,
    kind: 'kiro-question-bank-category' as const,
    exportedAt: nowIso(),
    category: {
      name: category.name,
      description: category.description,
      subcategories: category.subcategories.map((subcategory) => ({
        name: subcategory.name,
        description: subcategory.description,
        questions: subcategory.questions.map((question) => ({
          type: question.type,
          bodyMarkdown: question.bodyMarkdown,
          explanationMarkdown: question.explanationMarkdown,
          options: question.options.map((option) => ({
            bodyMarkdown: option.bodyMarkdown,
            correct: option.correct,
          })),
        })),
      })),
    },
  }

  const safeName = category.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'category'
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${safeName}.kiroq.json"`)
  return c.body(JSON.stringify(exportFile, null, 2))
})

app.post('/api/import', async (c) => {
  try {
    const category = validateCategoryImport(await c.req.json())
    const categoryId = id()
    const createdAt = nowIso()

    const subcategoryRows: Array<Record<string, string | number | null>> = []
    const questionRows: Array<Record<string, string | number | null>> = []
    const optionRows: Array<Record<string, string | number | null>> = []

    category.subcategories.forEach((subcategory, subcategoryPosition) => {
      const subcategoryId = id()
      subcategoryRows.push({
        id: subcategoryId,
        categoryId,
        name: subcategory.name,
        description: subcategory.description ?? null,
        position: subcategoryPosition,
      })

      subcategory.questions.forEach((question, questionPosition) => {
        const questionId = id()
        questionRows.push({
          id: questionId,
          subcategoryId,
          type: question.type,
          bodyMarkdown: question.bodyMarkdown,
          explanationMarkdown: question.explanationMarkdown ?? null,
          position: questionPosition,
        })

        question.options.forEach((option, optionPosition) => {
          optionRows.push({
            id: id(),
            questionId,
            bodyMarkdown: option.bodyMarkdown,
            correct: option.correct ? 1 : 0,
            position: optionPosition,
          })
        })
      })
    })

    const statements: D1PreparedStatement[] = [
      c.env.DB
        .prepare('INSERT INTO categories (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(categoryId, category.name, category.description ?? null, createdAt, createdAt),
    ]

    if (subcategoryRows.length > 0) {
      statements.push(
        c.env.DB
          .prepare(`
            INSERT INTO subcategories (id, category_id, name, description, position)
            SELECT
              json_extract(value, '$.id'),
              json_extract(value, '$.categoryId'),
              json_extract(value, '$.name'),
              json_extract(value, '$.description'),
              json_extract(value, '$.position')
            FROM json_each(?)
          `)
          .bind(JSON.stringify(subcategoryRows)),
      )
    }

    if (questionRows.length > 0) {
      statements.push(
        c.env.DB
          .prepare(`
            INSERT INTO questions (id, subcategory_id, type, body_markdown, explanation_markdown, position)
            SELECT
              json_extract(value, '$.id'),
              json_extract(value, '$.subcategoryId'),
              json_extract(value, '$.type'),
              json_extract(value, '$.bodyMarkdown'),
              json_extract(value, '$.explanationMarkdown'),
              json_extract(value, '$.position')
            FROM json_each(?)
          `)
          .bind(JSON.stringify(questionRows)),
      )
    }

    if (optionRows.length > 0) {
      statements.push(
        c.env.DB
          .prepare(`
            INSERT INTO question_options (id, question_id, body_markdown, is_correct, position)
            SELECT
              json_extract(value, '$.id'),
              json_extract(value, '$.questionId'),
              json_extract(value, '$.bodyMarkdown'),
              json_extract(value, '$.correct'),
              json_extract(value, '$.position')
            FROM json_each(?)
          `)
          .bind(JSON.stringify(optionRows)),
      )
    }

    await c.env.DB.batch(statements)
    return c.json({ id: categoryId }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid import file' }, 400)
  }
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
