"use client";

import { useState } from "react";
import { type Task } from "@/lib/types";
import TaskCard from "@/components/dashboard/TaskCard";
import { getTaskColorCategory } from "@/lib/colors";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import CreateTaskModal from "./CreateTaskModal";

interface AllTasksClientProps {
    todos: Task[];
    tasks: Task[];
    currentUserId: string;
}

export default function AllTasksClient({ todos, tasks, currentUserId }: AllTasksClientProps) {
    const [activeTab, setActiveTab] = useState<"todos" | "tasks">("tasks"); // default to tasks
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    return (
        <div className="max-w-3xl animate-fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 relative z-50">
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
                    All Tasks
                </h1>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="shrink-0 flex items-center justify-center p-2.5 sm:px-4 sm:py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                    >
                        <Plus className="w-5 h-5 sm:mr-2" />
                        <span className="hidden sm:inline font-semibold text-sm">Create Task</span>
                    </button>
                </div>
            </div>

            {/* Horizontal Toggles */}
            <div className="flex bg-gray-100 rounded-xl p-1 mb-8">
                <button
                    onClick={() => setActiveTab("todos")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                        activeTab === "todos"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    To-dos
                    <span className={cn(
                        "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                        activeTab === "todos" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                    )}>
                        {todos.length}
                    </span>
                </button>
                <button
                    onClick={() => setActiveTab("tasks")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                        activeTab === "tasks"
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    Tasks
                    <span className={cn(
                        "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                        activeTab === "tasks" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                    )}>
                        {tasks.length}
                    </span>
                </button>
            </div>

            {/* Content Area */}
            {activeTab === "todos" ? (
                <div className="space-y-3">
                    {todos.length === 0 ? (
                        <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                            <p className="text-sm text-gray-500 font-medium">No to-dos found.</p>
                        </div>
                    ) : (
                        todos.map(todo => (
                            <TaskCard
                                key={todo.id}
                                task={todo}
                                category={getTaskColorCategory(todo, currentUserId)}
                                currentUserId={currentUserId}
                            />
                        ))
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {tasks.length === 0 ? (
                        <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                            <p className="text-sm text-gray-500 font-medium">No tasks found.</p>
                        </div>
                    ) : (
                        tasks.map(task => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                category={getTaskColorCategory(task, currentUserId)}
                                currentUserId={currentUserId}
                            />
                        ))
                    )}
                </div>
            )}

            <CreateTaskModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
            />
        </div>
    );
}
