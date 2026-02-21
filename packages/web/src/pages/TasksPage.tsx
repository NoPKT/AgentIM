import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'
import { toast } from '../stores/toast.js'
import { useChatStore } from '../stores/chat.js'
import { Button, Input, Modal, ModalPanel, Textarea, Select } from '../components/ui.js'
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
      toast.error(res.error || t('common.error'))
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
    failed: tasks.filter((t) => t.status === 'failed'),
    cancelled: tasks.filter((t) => t.status === 'cancelled'),
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-4 sm:px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 animate-pulse">
            <div className="h-8 w-24 bg-skeleton rounded" />
            <div className="mt-2 h-4 w-32 bg-surface-hover rounded" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-surface-hover rounded-lg p-4 animate-pulse">
                <div className="h-5 w-20 bg-skeleton rounded mb-4" />
                <div className="space-y-3">
                  <div className="bg-surface rounded-lg p-4 space-y-2">
                    <div className="h-4 w-3/4 bg-skeleton rounded" />
                    <div className="h-3 w-full bg-surface-hover rounded" />
                  </div>
                  <div className="bg-surface rounded-lg p-4 space-y-2">
                    <div className="h-4 w-1/2 bg-skeleton rounded" />
                    <div className="h-3 w-2/3 bg-surface-hover rounded" />
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
      <div className="flex-1 flex items-center justify-center bg-surface-secondary px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-12 w-12 text-text-muted"
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
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{t('common.loadFailed')}</h3>
          <Button onClick={loadTasks} className="mt-4">
            {t('common.retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-4 sm:px-6 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{t('task.tasks')}</h1>
            <p className="mt-1 text-sm text-text-secondary">
              {t('task.tasksCount', { count: tasks.length })}
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>{t('task.newTask')}</Button>
        </div>

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="text-center py-12 bg-surface rounded-lg border border-border">
            <svg
              className="mx-auto h-12 w-12 text-text-muted"
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
            <h3 className="mt-4 text-lg font-medium text-text-primary">{t('task.noTasks')}</h3>
            <p className="mt-2 text-sm text-text-secondary">{t('task.createFirstTask')}</p>
          </div>
        )}

        {/* Task Groups */}
        {tasks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            <TaskColumn
              title={t('task.pending')}
              tasks={groupedTasks.pending}
              badgeColor="bg-badge-bg text-badge-text"
              onUpdateStatus={handleUpdateStatus}
            />
            <TaskColumn
              title={t('task.inProgress')}
              tasks={groupedTasks.in_progress}
              badgeColor="bg-info-muted text-info-text"
              onUpdateStatus={handleUpdateStatus}
            />
            <TaskColumn
              title={t('task.completed')}
              tasks={groupedTasks.completed}
              badgeColor="bg-success-muted text-success-text"
              onUpdateStatus={handleUpdateStatus}
            />
            <TaskColumn
              title={t('task.failed')}
              tasks={groupedTasks.failed}
              badgeColor="bg-danger-muted text-danger-text"
              onUpdateStatus={handleUpdateStatus}
            />
            <TaskColumn
              title={t('task.cancelled')}
              tasks={groupedTasks.cancelled}
              badgeColor="bg-warning-muted text-warning-text"
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
    <div className="bg-surface-hover rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-text-primary">{title}</h2>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeColor}`}>
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onUpdateStatus={onUpdateStatus} />
        ))}
        {tasks.length === 0 && <p className="text-sm text-text-muted text-center py-4">--</p>}
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
  const { t, i18n } = useTranslation()

  const statusOptions = [
    {
      value: 'pending',
      label: t('task.pending'),
      color: 'bg-badge-bg text-badge-text',
    },
    {
      value: 'in_progress',
      label: t('task.inProgress'),
      color: 'bg-info-muted text-info-text',
    },
    {
      value: 'completed',
      label: t('task.completed'),
      color: 'bg-success-muted text-success-text',
    },
    {
      value: 'failed',
      label: t('task.failed'),
      color: 'bg-danger-muted text-danger-text',
    },
    {
      value: 'cancelled',
      label: t('task.cancelled'),
      color: 'bg-warning-muted text-warning-text',
    },
  ]

  return (
    <div className="bg-surface rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <h3 className="font-medium text-text-primary mb-2">{task.title}</h3>
      {task.description && (
        <p className="text-sm text-text-secondary line-clamp-2 mb-3">{task.description}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">
          {new Date(task.createdAt).toLocaleDateString(i18n.language, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <select
          value={task.status}
          onChange={(e) => onUpdateStatus(task.id, e.target.value)}
          aria-label={t('agent.status')}
          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-accent ${
            statusOptions.find((s) => s.value === task.status)?.color ??
            'bg-badge-bg text-badge-text'
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
      <ModalPanel className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-task-title" className="text-xl font-semibold text-text-primary">
            {t('task.createTask')}
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
            <label htmlFor="room" className="block text-sm font-medium text-text-primary mb-2">
              {t('chat.rooms')}
            </label>
            <Select id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-text-primary mb-2">
              {t('task.taskTitle')}
            </label>
            <Input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('task.enterTaskTitle')}
              autoFocus
              required
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-text-primary mb-2"
            >
              {t('task.taskDescription')}
            </label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t('task.enterTaskDescription')}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!roomId}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </ModalPanel>
    </Modal>
  )
}
