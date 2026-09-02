/**
 * Schema-intent review: does the any_routes tool schema, on its own, steer a
 * fresh model toward the correct next action — and not toward over/under-use?
 *
 * The tool schema is the frozen copy in ../comprehension/fixtures.json (single
 * source); the scenarios are frozen here. No live projection is needed because
 * the object under review is the schema text itself, not any tool output.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineReviewExperiment } from '@catheadowl/dsh-eval'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const tool = JSON.parse(readFileSync(join(here, '..', 'comprehension', 'fixtures.json'), 'utf8')).tool
const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')

export default defineReviewExperiment({
  id: 'any-routes-schema-intent',
  summary: 'Does the any_routes tool schema alone steer a fresh model to the right next action?',
  prompt,
  rubric: join(here, 'rubric.md'),
  async observe() {
    return [
      {
        heading: 'Tool',
        entries: [{
          heading: tool.name,
          paragraphs: [tool.description, `Parameters: ${JSON.stringify(tool.parameters)}`],
        }],
      },
      {
        heading: 'Scenarios (pick the ONE next action)',
        entries: fixtures.scenarios.map((scenario) => ({
          heading: scenario.id,
          paragraphs: [scenario.task],
        })),
      },
    ]
  },
})
