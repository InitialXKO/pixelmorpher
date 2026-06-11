'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, FolderOpen, Trash2, Copy, Upload, Clock, Image, Film, Edit3, Check, X, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAssetStore } from '@/lib/asset-store';
import type { ProjectMeta } from '@/lib/asset-types';

/** Format relative time */
function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  return `${months}个月前`;
}

export default function ProjectHomeScreen() {
  const {
    projectList,
    projectListLoaded,
    loadProjectList,
    createProject,
    openProject,
    deleteProject,
    duplicateProject,
    importProjectFromFile,
    setShowProjectHome,
  } = useAssetStore();

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectWidth, setNewProjectWidth] = useState(256);
  const [newProjectHeight, setNewProjectHeight] = useState(256);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProjectList();
  }, [loadProjectList]);

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim() || `项目 ${projectList.length + 1}`;
    const meta = await createProject(name, newProjectWidth, newProjectHeight);
    setShowNewDialog(false);
    setNewProjectName('');
    // Open the newly created project
    await openProject(meta.id);
  }, [newProjectName, newProjectWidth, newProjectHeight, projectList.length, createProject, openProject, setShowNewDialog]);

  const handleOpenProject = useCallback(async (id: string) => {
    await openProject(id);
  }, [openProject]);

  const handleDeleteProject = useCallback(async () => {
    if (deleteTarget) {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteProject]);

  const handleDuplicate = useCallback(async (project: ProjectMeta) => {
    await duplicateProject(project.id, `${project.name} 副本`);
  }, [duplicateProject]);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await importProjectFromFile(file);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [importProjectFromFile]);

  const startEditName = useCallback((project: ProjectMeta) => {
    setEditingName(project.id);
    setEditNameValue(project.name);
  }, []);

  const commitEditName = useCallback(async () => {
    if (editingName && editNameValue.trim()) {
      const { renameProject } = useAssetStore.getState();
      await renameProject(editingName, editNameValue.trim());
    }
    setEditingName(null);
  }, [editingName, editNameValue]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a16] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-center pt-16 pb-8 px-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-zinc-100 tracking-tight">
            Pixel<span className="text-purple-400">Morpher</span>
          </h1>
          <p className="text-sm text-zinc-500 mt-1">像素动画编辑器</p>
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-center gap-3 px-8 pb-6">
        <Button
          className="bg-purple-600 hover:bg-purple-500 text-white gap-1.5 h-9 px-4 text-xs"
          onClick={() => setShowNewDialog(true)}
        >
          <Plus className="size-3.5" />
          新建项目
        </Button>
        <Button
          variant="outline"
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-1.5 h-9 px-4 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          导入项目
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pxm,.json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>

      {/* Project Grid */}
      <div className="flex-1 px-8 pb-8">
        {!projectListLoaded ? (
          <div className="text-center text-zinc-500 text-xs mt-12">加载中...</div>
        ) : projectList.length === 0 ? (
          <div className="text-center mt-12">
            <FolderOpen className="size-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">还没有项目</p>
            <p className="text-xs text-zinc-600 mt-1">点击"新建项目"开始创作</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-w-6xl mx-auto">
            {projectList.map((project) => (
              <div
                key={project.id}
                className="group relative bg-zinc-900/80 border border-zinc-800 rounded-lg overflow-hidden hover:border-purple-600/50 hover:bg-zinc-900 transition-all cursor-pointer"
                onClick={() => handleOpenProject(project.id)}
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-zinc-950 flex items-center justify-center relative overflow-hidden">
                  {project.thumbnail ? (
                    <img
                      src={project.thumbnail}
                      alt={project.name}
                      className="w-full h-full object-contain pixelated"
                    />
                  ) : (
                    <span className="text-4xl font-bold text-zinc-800 select-none">
                      {project.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-purple-600/0 group-hover:bg-purple-600/10 transition-all flex items-center justify-center">
                    <FolderOpen className="size-8 text-purple-400 opacity-0 group-hover:opacity-80 transition-opacity" />
                  </div>
                </div>

                {/* Info */}
                <div className="p-2">
                  {/* Name - editable on double click */}
                  {editingName === project.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="h-5 text-xs bg-zinc-800 border-zinc-700"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEditName();
                          if (e.key === 'Escape') setEditingName(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        onClick={(e) => { e.stopPropagation(); commitEditName(); }}
                      >
                        <Check className="size-3" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="text-xs font-medium text-zinc-200 truncate flex items-center gap-1"
                      onDoubleClick={(e) => { e.stopPropagation(); startEditName(project); }}
                    >
                      {project.name}
                      <Edit3 className="size-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-0.5">
                      <Image className="size-2.5" />
                      {project.canvasWidth}×{project.canvasHeight}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Film className="size-2.5" />
                      {project.frameCount}帧
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-600">
                    <Clock className="size-2.5" />
                    {relativeTime(project.updatedAt)}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-zinc-500 hover:text-zinc-200"
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(project); }}
                      title="复制项目"
                    >
                      <Copy className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-zinc-500 hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(project); }}
                      title="删除项目"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm text-zinc-100">新建项目</DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              设置项目名称和画布尺寸
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">项目名称</label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder={`项目 ${projectList.length + 1}`}
                className="h-8 text-xs bg-zinc-800 border-zinc-700 mt-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); }}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">宽度</label>
                <Input
                  type="number"
                  value={newProjectWidth}
                  onChange={(e) => setNewProjectWidth(Number(e.target.value) || 256)}
                  className="h-8 text-xs bg-zinc-800 border-zinc-700 mt-1"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">高度</label>
                <Input
                  type="number"
                  value={newProjectHeight}
                  onChange={(e) => setNewProjectHeight(Number(e.target.value) || 256)}
                  className="h-8 text-xs bg-zinc-800 border-zinc-700 mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="text-xs text-zinc-400" onClick={() => setShowNewDialog(false)}>
                取消
              </Button>
              <Button size="sm" className="text-xs bg-purple-600 hover:bg-purple-500" onClick={handleCreateProject}>
                创建
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm text-zinc-100">确认删除</DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              确定要删除项目「{deleteTarget?.name}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="text-xs text-zinc-400" onClick={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button size="sm" className="text-xs bg-red-600 hover:bg-red-500" onClick={handleDeleteProject}>
                删除
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
