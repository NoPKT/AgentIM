import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

/**
 * Tasks / Kanban page E2E tests.
 *
 * Each test authenticates independently via API login so that
 * strict token rotation / logout in other tests cannot interfere.
 *
 * Tests create a room via API when needed, then exercise the task
 * CRUD operations through both the UI and direct API calls.
 */

// Start with a clean cookie jar — loginAsAdmin provides fresh auth per test.
test.use({ storageState: { cookies: [], origins: [] } })

/** Helper: create a room via API and return its id + name. */
async function createTestRoom(page: import('@playwright/test').Page) {
  const roomName = `e2e-task-room-${Date.now()}`
  const res = await page.request.post('/api/rooms', {
    data: { name: roomName },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { ok: boolean; data: { id: string; name: string } }
  expect(body.ok).toBe(true)
  return body.data
}

/** Helper: create a task via API and return the task object. */
async function createTestTask(
  page: import('@playwright/test').Page,
  roomId: string,
  title: string,
) {
  const res = await page.request.post(`/api/tasks/rooms/${roomId}`, {
    data: { title, description: 'e2e test task' },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as {
    ok: boolean
    data: { id: string; title: string; status: string }
  }
  expect(body.ok).toBe(true)
  return body.data
}

/** Helper: delete a task via API (cleanup). */
async function deleteTask(page: import('@playwright/test').Page, taskId: string) {
  await page.request.delete(`/api/tasks/${taskId}`)
}

/** Helper: delete a room via API (cleanup). */
async function deleteRoom(page: import('@playwright/test').Page, roomId: string) {
  await page.request.delete(`/api/rooms/${roomId}`)
}

test.describe('Tasks page', () => {
  test('navigates to /tasks successfully', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/tasks')
    await expect(page).toHaveURL(/\/tasks/)
    await page.waitForLoadState('networkidle')
    // Should not show an error page
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('shows empty state or task list', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')

    // Page should contain either task columns or an empty-state message
    const hasTasks = await page.getByText(/pending|in.?progress|completed/i).count()
    const hasEmpty = await page.getByText(/no tasks|create.*task/i).count()
    expect(hasTasks + hasEmpty).toBeGreaterThan(0)
  })

  test('can create a task via the UI', async ({ page }) => {
    test.setTimeout(60_000)
    await loginAsAdmin(page)

    // Create a room first so the task dialog has a room to select
    const room = await createTestRoom(page)
    let taskId: string | undefined

    try {
      await page.goto('/tasks')
      await page.waitForLoadState('networkidle')

      // Click the "New Task" button
      const newTaskButton = page.getByRole('button', { name: /new task/i })
      await expect(newTaskButton).toBeVisible({ timeout: 10_000 })
      await newTaskButton.click()

      // Fill in the task title
      const titleInput = page.getByPlaceholder(/enter.*task.*title|task title/i)
      await expect(titleInput).toBeVisible({ timeout: 5_000 })
      const testTitle = `e2e-task-${Date.now()}`
      await titleInput.fill(testTitle)

      // Submit the form
      const createButton = page.getByRole('button', { name: /^create$/i })
      await createButton.click()

      // Task should appear somewhere on the page
      await expect(page.getByText(testTitle)).toBeVisible({ timeout: 10_000 })

      // Grab task id from API for cleanup
      const tasksRes = await page.request.get('/api/tasks')
      const tasksBody = (await tasksRes.json()) as {
        ok: boolean
        data: { id: string; title: string }[]
      }
      const created = tasksBody.data.find((t) => t.title === testTitle)
      taskId = created?.id
    } finally {
      // Cleanup
      if (taskId) await deleteTask(page, taskId)
      await deleteRoom(page, room.id)
    }
  })

  test('created task appears in the task list', async ({ page }) => {
    await loginAsAdmin(page)
    const room = await createTestRoom(page)
    const taskTitle = `e2e-visible-${Date.now()}`
    const task = await createTestTask(page, room.id, taskTitle)

    try {
      await page.goto('/tasks')
      await page.waitForLoadState('networkidle')

      // The created task should be visible in the kanban board
      await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteTask(page, task.id)
      await deleteRoom(page, room.id)
    }
  })

  test('can update task status via API', async ({ page }) => {
    await loginAsAdmin(page)
    const room = await createTestRoom(page)
    const task = await createTestTask(page, room.id, `e2e-status-${Date.now()}`)

    try {
      expect(task.status).toBe('pending')

      // Update status to in_progress
      const updateRes = await page.request.put(`/api/tasks/${task.id}`, {
        data: { status: 'in_progress' },
      })
      expect(updateRes.ok()).toBeTruthy()
      const updateBody = (await updateRes.json()) as {
        ok: boolean
        data: { id: string; status: string }
      }
      expect(updateBody.data.status).toBe('in_progress')
    } finally {
      await deleteTask(page, task.id)
      await deleteRoom(page, room.id)
    }
  })

  test('can delete a task via API', async ({ page }) => {
    await loginAsAdmin(page)
    const room = await createTestRoom(page)
    const task = await createTestTask(page, room.id, `e2e-delete-${Date.now()}`)

    try {
      // Delete the task
      const deleteRes = await page.request.delete(`/api/tasks/${task.id}`)
      expect(deleteRes.ok()).toBeTruthy()

      // Verify it no longer exists
      const getRes = await page.request.get('/api/tasks')
      const body = (await getRes.json()) as {
        ok: boolean
        data: { id: string }[]
      }
      const found = body.data.find((t) => t.id === task.id)
      expect(found).toBeUndefined()
    } finally {
      await deleteRoom(page, room.id)
    }
  })
})
