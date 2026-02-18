import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'
import { toast } from '../stores/toast.js'
import { useChatStore } from '../stores/chat.js'
import { Button, Input, Modal, Textarea, Select } from '../components/ui.js'
import { CloseIcon } from '../components/icons.js'
import type { Task } from '@agentim/shared'

export default function TasksPage() {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const rooms = useChatStore((state) => state.rooms)

  const loadTasks = async () => {
    setIsLoading(true)
    setLoadError(false)
    const res = await api.get<Task[]>('/tasks')
    if (res.ok && res.data) {
      setTasks(res.data)
    } else {
      setLoadError(true)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadTasks()
  }, [])

  // Listen for real-time task updates via WebSocket
  useEffect(() => {
    const handler = (e: Event) => {
      const updated = (e as CustomEvent<Task>).detail
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === updated.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updated
          return next
        }
        return [...prev, updated]
      })
    }
    window.addEventListener('agentim:task_update', handler)
    return () => window.removeEventListener('agentim:task_update', handler)
  }, [])

  const handleCreateTask = async (roomId: string, title: string, description: string) => {
    const res = await api.post<Task>(`/tasks/rooms/${roomId}`, { title, description })
    if (res.ok && res.data) {
      setTasks([...tasks, res.data])
      setIsDialogOpen(false)
    } else {
      toast.error(res.error || t('error'))
    }
  }

  const handleUpdateStatus = async (taskId: string, status: string) => {
    const res = await api.put<Task>(`/tasks/${taskId}`, { status })
    if (res.ok && res.data) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? res.data! : t)))
    }
  }

  const groupedTasks = {
    pending: tasks.filter((t) => t.status === 'pending'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    completed: tasks.filter((t) => t.status === 'completed'),
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 px-4 sm:px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 animate-pulse">
            <div className="h-8 w-24 bg-gray-200 dark:bg-gray-600 rounded" />
            <div className="mt-2 h-4 w-32 bg-gray-100 dark:bg-gray-700 rounded" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 animate-pulse">
                <div className="h-5 w-20 bg-gray-200 dark:bg-gray-600 rounded mb-4" />
                <div className="space-y-3">
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-600 rounded" />
                    <div className="h-3 w-full bg-gray-100 dark:bg-gray-700 rounded" />
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                    <div className="h-4 w-1/2 bg-gray-200 dark:bg-gray-600 rounded" />
                    <div className="h-3 w-2/3 bg-gray-100 dark:bg-gray-700 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('loadFailed')}
          </h3>
          <Button onClick={loadTasks} className="mt-4">
            {t('retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('tasks')}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t('tasksCount', { count: tasks.length })}
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>
            {t('newTask')}
          </Button>
        </div>

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">
              {t('noTasks')}
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t('createFirstTask') || 'Create your first task to get started'}
            </p>
          </div>
        )}

        {/* Task Groups */}
        {tasks.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <TaskColumn
              title={t('pending')}
              tasks={groupedTasks.pending}
              badgeColor="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
              onUpdateStatus={handleUpdateStatus}
            />
            <TaskColumn
              title={t('inProgress')}
              tasks={groupedTasks.in_progress}
              badgeColor="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
              onUpdateStatus={handleUpdateStatus}
            />
            <TaskColumn
              title={t('completed')}
              tasks={groupedTasks.completed}
              badgeColor="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              onUpdateStatus={handleUpdateStatus}
            />
          </div>
        )}

        {/* Create Task Dialog */}
        {isDialogOpen && (
          <CreateTaskDialog
            rooms={rooms}
            onClose={() => setIsDialogOpen(false)}
            onCreate={handleCreateTask}
          />
        )}
      </div>
    </div>
  )
}

function TaskColumn({
  title,
  tasks,
  badgeColor,
  onUpdateStatus,
}: {
  title: string
  tasks: Task[]
  badgeColor: string
  onUpdateStatus: (taskId: string, status: string) => void
}) {
  return (
    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeColor}`}>
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onUpdateStatus={onUpdateStatus} />
        ))}
        {tasks.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">--</p>
        )}
      </div>
    </div>
  )
}

function TaskCard({
  task,
  onUpdateStatus,
}: {
  task: Task
  onUpdateStatus: (taskId: string, status: string) => void
}) {
  const { t } = useTranslation()

  const statusOptions = [
    {
      value: 'pending',
      label: t('pending'),
      color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    },
    {
      value: 'in_progress',
      label: t('inProgress'),
      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    },
    {
      value: 'completed',
      label: t('completed'),
      color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    },
  ]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">{task.title}</h3>
      {task.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
          {task.description}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(task.createdAt).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <select
          value={task.status}
          onChange={(e) => onUpdateStatus(task.id, e.target.value)}
          aria-label={t('status')}
          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 ${
            statusOptions.find((s) => s.value === task.status)?.color ??
            'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function CreateTaskDialog({
  rooms,
  onClose,
  onCreate,
}: {
  rooms: { id: string; name: string }[]
  onClose: () => void
  onCreate: (roomId: string, title: string, description: string) => void
}) {
  const { t } = useTranslation()
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim() && roomId) {
      onCreate(roomId, title, description)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} aria-labelledby="create-task-title">
      <div className="bg-surface rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-task-title" className="text-xl font-semibold text-text-primary">
            {t('createTask')}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="room"
              className="block text-sm font-medium text-text-primary mb-2"
            >
              {t('rooms') || 'Room'}
            </label>
            <Select
              id="room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-text-primary mb-2"
            >
              {t('taskTitle')}
            </label>
            <Input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('enterTaskTitle') || 'Enter task title'}
              autoFocus
              required
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-text-primary mb-2"
            >
              {t('taskDescription')}
            </label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t('enterTaskDescription') || 'Enter task description (optional)'}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!roomId}>
              {t('create')}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
