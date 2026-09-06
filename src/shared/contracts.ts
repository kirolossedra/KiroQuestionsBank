export type QuestionType = 'mcq' | 'multi_select'

export interface PortableOption {
  bodyMarkdown: string
  correct: boolean
}

export interface PortableQuestion {
  type: QuestionType
  bodyMarkdown: string
  explanationMarkdown?: string | null
  options: PortableOption[]
}

export interface PortableSubcategory {
  name: string
  description?: string | null
  questions: PortableQuestion[]
}

export interface PortableCategory {
  name: string
  description?: string | null
  subcategories: PortableSubcategory[]
}

export interface CategoryExportFile {
  schemaVersion: 1
  kind: 'kiro-question-bank-category'
  exportedAt: string
  category: PortableCategory
}

export interface CategorySummary {
  id: string
  name: string
  description: string | null
  subcategoryCount: number
  questionCount: number
  createdAt: string
}

export interface QuestionOption extends PortableOption {
  id: string
}

export interface Question extends Omit<PortableQuestion, 'options'> {
  id: string
  options: QuestionOption[]
}

export interface Subcategory extends Omit<PortableSubcategory, 'questions'> {
  id: string
  questions: Question[]
}

export interface CategoryDetail extends Omit<PortableCategory, 'subcategories'> {
  id: string
  createdAt: string
  updatedAt: string
  subcategories: Subcategory[]
}

export interface CreateQuestionInput extends PortableQuestion {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value.trim()
}

const nullableString = (value: unknown, path: string): string | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${path} must be a string or null`)
  return value.trim() || null
}

export function validateQuestion(value: unknown, path = 'question'): PortableQuestion {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)

  const type = value.type
  if (type !== 'mcq' && type !== 'multi_select') {
    throw new Error(`${path}.type must be "mcq" or "multi_select"`)
  }

  if (!Array.isArray(value.options) || value.options.length < 2) {
    throw new Error(`${path}.options must contain at least two options`)
  }

  const options = value.options.map((option, index) => {
    if (!isRecord(option)) throw new Error(`${path}.options[${index}] must be an object`)
    if (typeof option.correct !== 'boolean') {
      throw new Error(`${path}.options[${index}].correct must be a boolean`)
    }
    return {
      bodyMarkdown: nonEmptyString(option.bodyMarkdown, `${path}.options[${index}].bodyMarkdown`),
      correct: option.correct,
    }
  })

  const correctCount = options.filter((option) => option.correct).length
  if (type === 'mcq' && correctCount !== 1) {
    throw new Error(`${path} is MCQ and must have exactly one correct option`)
  }
  if (type === 'multi_select' && correctCount < 2) {
    throw new Error(`${path} is multi-select and must have at least two correct options`)
  }

  return {
    type,
    bodyMarkdown: nonEmptyString(value.bodyMarkdown, `${path}.bodyMarkdown`),
    explanationMarkdown: nullableString(value.explanationMarkdown, `${path}.explanationMarkdown`),
    options,
  }
}

export function validateCategoryImport(value: unknown): PortableCategory {
  if (!isRecord(value)) throw new Error('Import file must be an object')
  if (value.schemaVersion !== 1) throw new Error('Unsupported schemaVersion; expected 1')
  if (value.kind !== 'kiro-question-bank-category') {
    throw new Error('Invalid import kind; expected "kiro-question-bank-category"')
  }
  if (!isRecord(value.category)) throw new Error('category must be an object')

  const source = value.category
  if (!Array.isArray(source.subcategories)) throw new Error('category.subcategories must be an array')

  return {
    name: nonEmptyString(source.name, 'category.name'),
    description: nullableString(source.description, 'category.description'),
    subcategories: source.subcategories.map((subcategory, subcategoryIndex) => {
      const path = `category.subcategories[${subcategoryIndex}]`
      if (!isRecord(subcategory)) throw new Error(`${path} must be an object`)
      if (!Array.isArray(subcategory.questions)) throw new Error(`${path}.questions must be an array`)

      return {
        name: nonEmptyString(subcategory.name, `${path}.name`),
        description: nullableString(subcategory.description, `${path}.description`),
        questions: subcategory.questions.map((question, questionIndex) =>
          validateQuestion(question, `${path}.questions[${questionIndex}]`),
        ),
      }
    }),
  }
}
