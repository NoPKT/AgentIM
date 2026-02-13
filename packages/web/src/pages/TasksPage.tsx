import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import type { Task } from '@agentim/shared';

export default function TasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const loadTasks = async () => {
    setIsLoading(true);
    const res = await api.get<Task[]>('/tasks');
    if (res.ok && res.data) {
      setTasks(res.data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleCreateTask = async (title: string, description: string) => {
    const res = await api.post<Task>('/tasks', { title, description });
    if (res.ok && res.data) {
      setTasks([...tasks, res.data]);
      setIsDialogOpen(false);
    }
  };

  const groupedTasks = {
    pending: tasks.filter((t) => t.status === 'pending'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    completed: tasks.filter((t) => t.status === 'completed'),
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('tasks')}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} total
            </p>
          </div>
          <button
            onClick={() => setIsDialogOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {t('newTask')}
          </button>
        </div>

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
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
            <h3 className="mt-4 text-lg font-medium text-gray-900">{t('noTasks')}</h3>
            <p className="mt-2 text-sm text-gray-600">
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
              status="pending"
              badgeColor="bg-gray-100 text-gray-800"
            />
            <TaskColumn
              title={t('inProgress')}
              tasks={groupedTasks.in_progress}
              status="in_progress"
              badgeColor="bg-blue-100 text-blue-800"
            />
            <TaskColumn
              title={t('completed')}
              tasks={groupedTasks.completed}
              status="completed"
              badgeColor="bg-green-100 text-green-800"
            />
          </div>
        )}

        {/* Create Task Dialog */}
        {isDialogOpen && (
          <CreateTaskDialog
            onClose={() => setIsDialogOpen(false)}
            onCreate={handleCreateTask}
          />
        )}
      </div>
    </div>
  );
}

function TaskColumn({
  title,
  tasks,
  status,
  badgeColor,
}: {
  title: string;
  tasks: Task[];
  status: string;
  badgeColor: string;
}) {
  return (
    <div className="bg-gray-100 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeColor}`}>
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">No tasks</p>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer">
      <h3 className="font-medium text-gray-900 mb-2">{task.title}</h3>
      {task.description && (
        <p className="text-sm text-gray-600 line-clamp-2 mb-3">{task.description}</p>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {new Date(task.createdAt).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        {task.assigneeId && (
          <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full font-medium">
            Assigned
          </span>
        )}
      </div>
    </div>
  );
}

function CreateTaskDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, description: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onCreate(title, description);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">{t('createTask')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
              {t('taskTitle')}
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder={t('enterTaskTitle') || 'Enter task title'}
              autoFocus
              required
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              {t('taskDescription')}
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
              rows={4}
              placeholder={t('enterTaskDescription') || 'Enter task description (optional)'}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {t('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
