import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  CategoryDetail,
  CategorySummary,
  PortableOption,
  QuestionType,
} from '../shared/contracts'

type ApiError = { error?: string }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiError
    throw new Error(payload.error || `Request failed with ${response.status}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function QuestionEditor({ subcategoryId, onSaved }: { subcategoryId: string; onSaved: () => Promise<void> }) {
  const [type, setType] = useState<QuestionType>('mcq')
  const [bodyMarkdown, setBodyMarkdown] = useState('')
  const [explanationMarkdown, setExplanationMarkdown] = useState('')
  const [options, setOptions] = useState<PortableOption[]>([
    { bodyMarkdown: '', correct: true },
    { bodyMarkdown: '', correct: false },
    { bodyMarkdown: '', correct: false },
    { bodyMarkdown: '', correct: false },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const setCorrect = (index: number) => {
    setOptions((current) =>
      current.map((option, optionIndex) => ({
        ...option,
        correct: type === 'mcq' ? optionIndex === index : optionIndex === index ? !option.correct : option.correct,
      })),
    )
  }

  const changeType = (nextType: QuestionType) => {
    setType(nextType)
    setOptions((current) =>
      current.map((option, index) => ({
        ...option,
        correct: nextType === 'mcq' ? index === 0 : option.correct,
      })),
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/subcategories/${subcategoryId}/questions`, {
        method: 'POST',
        body: JSON.stringify({
          type,
          bodyMarkdown,
          explanationMarkdown: explanationMarkdown || null,
          options,
        }),
      })
      setBodyMarkdown('')
      setExplanationMarkdown('')
      setType('mcq')
      setOptions([
        { bodyMarkdown: '', correct: true },
        { bodyMarkdown: '', correct: false },
        { bodyMarkdown: '', correct: false },
        { bodyMarkdown: '', correct: false },
      ])
      await onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add question')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="question-editor" onSubmit={submit}>
      <div className="question-editor__header">
        <strong>Add question</strong>
        <div className="segmented" role="group" aria-label="Question type">
          <button type="button" className={type === 'mcq' ? 'active' : ''} onClick={() => changeType('mcq')}>
            MCQ
          </button>
          <button
            type="button"
            className={type === 'multi_select' ? 'active' : ''}
            onClick={() => changeType('multi_select')}
          >
            Select multiple
          </button>
        </div>
      </div>

      <label>
        Question body
        <textarea
          value={bodyMarkdown}
          onChange={(event) => setBodyMarkdown(event.target.value)}
          placeholder="Question text — Markdown is supported by the data format"
          rows={4}
          required
        />
      </label>

      <div className="options-editor">
        <span>Answer options</span>
        {options.map((option, index) => (
          <div className="option-row" key={index}>
            <input
              aria-label={`Mark option ${index + 1} correct`}
              type={type === 'mcq' ? 'radio' : 'checkbox'}
              name={type === 'mcq' ? `correct-${subcategoryId}` : undefined}
              checked={option.correct}
              onChange={() => setCorrect(index)}
            />
            <input
              value={option.bodyMarkdown}
              onChange={(event) =>
                setOptions((current) =>
                  current.map((item, optionIndex) =>
                    optionIndex === index ? { ...item, bodyMarkdown: event.target.value } : item,
                  ),
                )
              }
              placeholder={`Option ${index + 1}`}
              required
            />
            {options.length > 2 && (
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove option ${index + 1}`}
                onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="text-button"
          type="button"
          onClick={() => setOptions((current) => [...current, { bodyMarkdown: '', correct: false }])}
        >
          + Add option
        </button>
      </div>

      <label>
        Explanation <span className="muted">optional</span>
        <textarea
          value={explanationMarkdown}
          onChange={(event) => setExplanationMarkdown(event.target.value)}
          rows={2}
        />
      </label>

      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save question'}
      </button>
    </form>
  )
}

export default function App() {
  const [categories, setCategories] = useState<CategorySummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryDetail | null>(null)
  const [name, setName] = useState('')
  const [subcategoryName, setSubcategoryName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadCategories = async () => {
    const result = await api<{ categories: CategorySummary[] }>('/api/categories')
    setCategories(result.categories)
    return result.categories
  }

  const loadCategory = async (categoryId: string) => {
    const result = await api<{ category: CategoryDetail }>(`/api/categories/${categoryId}`)
    setCategory(result.category)
  }

  useEffect(() => {
    loadCategories().catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load categories'))
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setCategory(null)
      return
    }
    loadCategory(selectedId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load category'))
  }, [selectedId])

  const createCategory = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const created = await api<{ id: string }>('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setName('')
      await loadCategories()
      setSelectedId(created.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create category')
    } finally {
      setBusy(false)
    }
  }

  const addSubcategory = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/categories/${selectedId}/subcategories`, {
        method: 'POST',
        body: JSON.stringify({ name: subcategoryName }),
      })
      setSubcategoryName('')
      await Promise.all([loadCategories(), loadCategory(selectedId)])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add subcategory')
    } finally {
      setBusy(false)
    }
  }

  const importCategory = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const created = await api<{ id: string }>('/api/import', {
        method: 'POST',
        body: JSON.stringify(parsed),
      })
      await loadCategories()
      setSelectedId(created.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import category')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setBusy(false)
    }
  }

  const deleteCategory = async () => {
    if (!selectedId || !category) return
    if (!window.confirm(`Delete “${category.name}” and all of its questions?`)) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/categories/${selectedId}`, { method: 'DELETE' })
      setSelectedId(null)
      setCategory(null)
      await loadCategories()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete category')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Question bank</span>
          <h1>KiroQuestionsBank</h1>
        </div>
        <div className="topbar-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.kiroq.json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importCategory(file)
            }}
          />
          <button className="secondary" type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            Import category
          </button>
        </div>
      </header>

      {error && <div className="global-error">{error}</div>}

      <main className="layout">
        <aside className="sidebar">
          <form className="create-category" onSubmit={createCategory}>
            <label>
              New category
              <div className="inline-form">
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. FOSA" required />
                <button className="primary" type="submit" disabled={busy}>+</button>
              </div>
            </label>
          </form>

          <div className="category-list">
            {categories.length === 0 && <p className="empty">No categories yet.</p>}
            {categories.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`category-card ${selectedId === item.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.subcategoryCount} groups · {item.questionCount} questions</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="workspace">
          {!category ? (
            <div className="welcome">
              <span className="eyebrow">Start here</span>
              <h2>Select a category or import one.</h2>
              <p>A category is a question bank grouping. For a book-based bank, use the book name as the category.</p>
            </div>
          ) : (
            <>
              <div className="workspace-header">
                <div>
                  <span className="eyebrow">Category</span>
                  <h2>{category.name}</h2>
                  <p>{category.subcategories.reduce((sum, subcategory) => sum + subcategory.questions.length, 0)} questions</p>
                </div>
                <div className="workspace-actions">
                  <a className="secondary button-link" href={`/api/categories/${category.id}/export`}>
                    Export JSON
                  </a>
                  <button className="danger" type="button" onClick={deleteCategory} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>

              <form className="add-subcategory" onSubmit={addSubcategory}>
                <label>
                  Add question group / subcategory
                  <div className="inline-form wide">
                    <input
                      value={subcategoryName}
                      onChange={(event) => setSubcategoryName(event.target.value)}
                      placeholder="e.g. Chapter 4 Questions or Cross-Chapter Exam"
                      required
                    />
                    <button className="primary" type="submit" disabled={busy}>Add</button>
                  </div>
                </label>
              </form>

              <div className="subcategory-list">
                {category.subcategories.length === 0 && (
                  <div className="empty-panel">Create the first question group for this category.</div>
                )}
                {category.subcategories.map((subcategory) => (
                  <article className="subcategory" key={subcategory.id}>
                    <div className="subcategory-title">
                      <div>
                        <h3>{subcategory.name}</h3>
                        <span>{subcategory.questions.length} questions</span>
                      </div>
                    </div>

                    <div className="questions">
                      {subcategory.questions.map((question, questionIndex) => (
                        <div className="question-card" key={question.id}>
                          <div className="question-meta">
                            <span>Q{questionIndex + 1}</span>
                            <span>{question.type === 'mcq' ? 'MCQ' : 'Select multiple'}</span>
                          </div>
                          <p className="question-body">{question.bodyMarkdown}</p>
                          <ul>
                            {question.options.map((option) => (
                              <li className={option.correct ? 'correct' : ''} key={option.id}>
                                {option.correct ? '✓ ' : ''}{option.bodyMarkdown}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>

                    <QuestionEditor subcategoryId={subcategory.id} onSaved={() => loadCategory(category.id)} />
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
