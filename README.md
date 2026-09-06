# KiroQuestionsBank

KiroQuestionsBank is a portable question-bank application built with React, Hono, Cloudflare Workers, and Cloudflare D1.

## Model

This is a **question bank**, not a book/chapter database.

The persistent hierarchy is intentionally generic:

- **Category** — a top-level question-bank grouping.
- **Subcategory** — a question grouping inside the category.
- **Question** — either `mcq` or `multi_select`.
- **Option** — an answer option attached to a question.

A book-based bank is one organization approach:

- Category: `Fundamentals of Software Architecture`
- Subcategory: `Chapter 4 Questions`
- Subcategory: `Chapter 5 Questions`
- Subcategory: `Cross-Chapter Exam`

`Chapter 4 Questions` is only the name of a question grouping. The system does not create a chapter entity or assume chapter metadata.

## Question storage

D1 stores the bank relationally rather than placing an entire question into a JSON column:

- `questions.type`
- `questions.body_markdown`
- `questions.explanation_markdown`
- answer choices in `question_options`
- correctness in `question_options.is_correct`
- ordering in explicit `position` columns

Question and explanation bodies are stored as Markdown text. This gives us portable plain text with enough formatting for code, emphasis, lists, and technical questions without storing rendered HTML.

### Question rules

- `mcq`: at least two options and exactly one correct option.
- `multi_select`: at least two options and at least two correct options.

## Category import/export format

A category is exported as a versioned JSON document. Database IDs are deliberately excluded because they are installation-specific. Fresh IDs are generated when the category is imported.

Example:

```json
{
  "schemaVersion": 1,
  "kind": "kiro-question-bank-category",
  "exportedAt": "2026-09-06T22:45:00.000Z",
  "category": {
    "name": "Fundamentals of Software Architecture",
    "description": null,
    "subcategories": [
      {
        "name": "Chapter 4 Questions",
        "description": null,
        "questions": [
          {
            "type": "mcq",
            "bodyMarkdown": "Which statement best describes connascence?",
            "explanationMarkdown": "Connascence describes how changes in one element can require corresponding changes elsewhere.",
            "options": [
              {
                "bodyMarkdown": "A form of change dependency",
                "correct": true
              },
              {
                "bodyMarkdown": "A database isolation level",
                "correct": false
              }
            ]
          },
          {
            "type": "multi_select",
            "bodyMarkdown": "Select all forms of static connascence.",
            "explanationMarkdown": null,
            "options": [
              {
                "bodyMarkdown": "Connascence of Name",
                "correct": true
              },
              {
                "bodyMarkdown": "Connascence of Type",
                "correct": true
              },
              {
                "bodyMarkdown": "Connascence of Timing",
                "correct": false
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Export files use the `.kiroq.json` suffix so they remain ordinary JSON files while being recognizable as KiroQuestionsBank category packages.

## Why relational storage + JSON transport

The database schema and interchange format have separate jobs:

- D1 remains queryable and editable at question/option level.
- Import/export remains human-readable and easy to generate from scripts or AI workflows.
- `schemaVersion` lets future import formats evolve without forcing stored questions into opaque blobs.
- New category organization approaches can reuse the same `category -> subcategory -> question` model.

The import API validates the entire document before writing it. It then uses a D1 batch, so the category import is committed as a unit or rolled back if a statement fails.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Worker health check |
| `GET` | `/api/categories` | List categories and question counts |
| `POST` | `/api/categories` | Create a category |
| `GET` | `/api/categories/:id` | Read a full category |
| `POST` | `/api/categories/:id/subcategories` | Add a question grouping |
| `POST` | `/api/subcategories/:id/questions` | Add a question |
| `GET` | `/api/categories/:id/export` | Export one category |
| `POST` | `/api/import` | Import one category package |
| `DELETE` | `/api/categories/:id` | Delete a category and its contents |

## Cloudflare D1 setup

Create the production D1 database:

```bash
npm install
npm run db:create
```

Cloudflare returns a database ID. Put it into `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`, then apply the migration:

```bash
npm run db:migrate
```

Build and deploy:

```bash
npm run deploy
```

The Worker handles `/api/*`; Cloudflare static assets serve the built React application.
