import React, { useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, X, Film, Languages, Upload, Video, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { getProductions, createProduction, updateProduction, deleteProduction, translateText as apiTranslate, uploadFile } from "./api"

const isLocalVideo = (url: string) => url.startsWith('/media/') || url.startsWith('/demo/')

type Topic = 'Security' | 'Economy' | 'Unity' | 'Identity' | 'Strength' | 'General'
type ApprovalStatus = 'Pending' | 'Approved' | 'Not Approved'

interface ProductionItem {
  id: string
  number: number
  date: string
  proposer_name: string
  topic: Topic
  idea: string
  idea_pending: boolean // true if edited and pending approval
  script: string
  script_pending: boolean // true if edited and pending approval
  script_approval: ApprovalStatus
  production_notes: string
  production_approval: ApprovalStatus
  video_url: string
  video_approval: ApprovalStatus
  distribution_published: boolean
  revision: number
  created_at?: string
  updated_at?: string
}

const TOPICS: Topic[] = ['Security', 'Economy', 'Unity', 'Identity', 'Strength', 'General']

const emptyProduction: Omit<ProductionItem, 'id' | 'number' | 'revision' | 'created_at' | 'updated_at'> = {
  date: new Date().toISOString().split('T')[0],
  proposer_name: '',
  topic: 'General',
  idea: '',
  idea_pending: false,
  script: '',
  script_pending: false,
  script_approval: 'Pending',
  production_notes: '',
  production_approval: 'Pending',
  video_url: '',
  video_approval: 'Pending',
  distribution_published: false,
}

export function Production() {
  const [userRole, setRole] = useState('team')
  const [translationEnabled, setTranslationEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [productions, setProductions] = useState<ProductionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<ProductionItem | null>(null)
  const [formData, setFormData] = useState(emptyProduction)
  const [translating, setTranslating] = useState<'idea' | 'script' | null>(null)
  const [ideaTranslation, setIdeaTranslation] = useState<{ text: string; language: string } | null>(null)
  const [scriptTranslation, setScriptTranslation] = useState<{ text: string; language: string } | null>(null)
  const [showIdeaTranslation, setShowIdeaTranslation] = useState(false)
  const [showScriptTranslation, setShowScriptTranslation] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const canApprove = userRole === 'reviewer'
  const canPublish = userRole === 'publisher' || userRole === 'reviewer'

  // Calculate progress for an item
  const getProgress = (item: ProductionItem) => {
    let completed = 0
    if (item.script_approval === 'Approved') completed++
    if (item.production_approval === 'Approved') completed++
    if (item.video_approval === 'Approved') completed++
    if (item.distribution_published) completed++
    return { completed, total: 4 }
  }

  useEffect(() => {
    fetchProductions()
  }, [])

  const fetchProductions = async () => {
    try {
      setIsLoading(true)
      const data = await getProductions()
      setRole(data.role)
      setTranslationEnabled(data.translation_enabled)
      setProductions((data.productions || []) as ProductionItem[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load productions')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (saving || uploadingVideo) return
    setSaving(true)
    setError(null)
    try {
      const dataToSave = { ...formData }

      // If user is not the reviewer and editing idea/script, mark as pending
      if (editingItem && userRole !== 'reviewer') {
        if (formData.idea !== editingItem.idea) {
          dataToSave.idea_pending = true
        }
        if (formData.script !== editingItem.script) {
          dataToSave.script_pending = true
        }
      }

      if (editingItem) {
        await updateProduction(editingItem.id, editingItem.revision, dataToSave)
      } else {
        await createProduction(dataToSave)
      }
      await fetchProductions()
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item: ProductionItem) => {
    if (!confirm('Delete this production item?')) return
    try {
      await deleteProduction(item.id, item.revision)
      await fetchProductions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleApproval = (field: 'script_approval' | 'production_approval' | 'video_approval', status: ApprovalStatus) => {
    const updates: Partial<typeof formData> = { [field]: status }

    // When the reviewer approves, clear pending flags
    if (status === 'Approved' && userRole === 'reviewer') {
      if (field === 'script_approval') {
        updates.idea_pending = false
        updates.script_pending = false
      }
    }

    setFormData({ ...formData, ...updates })
  }

  const openModal = (item?: ProductionItem) => {
    setError(null)
    setIdeaTranslation(null)
    setScriptTranslation(null)
    if (item) {
      setEditingItem(item)
      setFormData({
        date: item.date,
        proposer_name: item.proposer_name,
        topic: item.topic,
        idea: item.idea || '',
        idea_pending: item.idea_pending || false,
        script: item.script || '',
        script_pending: item.script_pending || false,
        script_approval: item.script_approval,
        production_notes: item.production_notes,
        production_approval: item.production_approval,
        video_url: item.video_url || '',
        video_approval: item.video_approval || 'Pending',
        distribution_published: item.distribution_published,
      })
    } else {
      setEditingItem(null)
      setFormData(emptyProduction)
    }
    setShowModal(true)
  }

  const closeModal = () => {
    setError(null)
    setShowModal(false)
    setEditingItem(null)
    setFormData(emptyProduction)
  }

  // Handle video file selection and upload to the local media store
  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingVideo(true)
    setUploadProgress(0)
    try {
      const downloadUrl = await uploadFile(file, (progress) => {
        setUploadProgress(Math.round(progress))
      })

      setFormData(current => ({ ...current, video_url: downloadUrl }))
    } catch (err) {
      console.error('Video upload error:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload video')
    } finally {
      setUploadingVideo(false)
      setUploadProgress(0)
    }
  }

  // AI Translation function using Gemini
  const handleTranslate = async (field: 'idea' | 'script', targetLang: 'hebrew' | 'english') => {
    const text = formData[field]
    if (!text) return

    setTranslating(field)
    try {
      const result = await apiTranslate(text, targetLang)
      const translation = { text: result.translated_text, language: targetLang }

      if (field === 'idea') {
        setIdeaTranslation(translation)
        setShowIdeaTranslation(true)
      } else {
        setScriptTranslation(translation)
        setShowScriptTranslation(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed')
    } finally {
      setTranslating(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Production</h1>
          <p className="text-sm text-muted-foreground">
            Manage video production workflow
            {userRole !== 'team' && <span className="ml-2 text-xs bg-primary/10 px-2 py-0.5 rounded">Role: {userRole}</span>}
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {error && !showModal && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline">Dismiss</button>
        </div>
      )}

      {/* Table */}
      {productions.length === 0 ? (
        <div className="text-center py-16 bg-card border rounded-lg">
          <Film className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-4">No productions yet</p>
          <button
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Create First
          </button>
        </div>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-left font-medium">Proposer</th>
                <th className="px-4 py-3 text-left font-medium">Topic</th>
                <th className="px-4 py-3 text-left font-medium">Idea</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {productions.map((item) => {
                const progress = getProgress(item)
                const isExpanded = expandedRow === item.id
                return (
                  <React.Fragment key={item.id}>
                    <tr
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : item.id)}
                    >
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                          {item.number}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.date}</td>
                      <td className="px-4 py-3">{item.proposer_name || '-'}</td>
                      <td className="px-4 py-3">{item.topic}</td>
                      <td className="px-4 py-3 max-w-[250px]">
                        <div className={`line-clamp-2 ${item.idea_pending ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {item.idea || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Progress bar */}
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden min-w-[60px]">
                            <div
                              className={`h-full transition-all ${
                                progress.completed === progress.total
                                  ? 'bg-green-500'
                                  : progress.completed > 0
                                    ? 'bg-blue-500'
                                    : 'bg-gray-300'
                              }`}
                              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {progress.completed}/{progress.total}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openModal(item) }}
                            className="p-1.5 hover:bg-muted rounded"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(item) }}
                            className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Expanded Preview Row */}
                    {isExpanded && (
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-6 py-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left: Details */}
                            <div className="space-y-4">
                              {/* Approval Status */}
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Approval Status</h4>
                                <div className="flex flex-wrap gap-2">
                                  <span className={`px-2 py-1 text-xs rounded-full ${
                                    item.script_approval === 'Approved' ? 'bg-green-100 text-green-700' :
                                    item.script_approval === 'Not Approved' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    Script: {item.script_approval}
                                  </span>
                                  <span className={`px-2 py-1 text-xs rounded-full ${
                                    item.production_approval === 'Approved' ? 'bg-green-100 text-green-700' :
                                    item.production_approval === 'Not Approved' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    Production: {item.production_approval}
                                  </span>
                                  <span className={`px-2 py-1 text-xs rounded-full ${
                                    item.video_approval === 'Approved' ? 'bg-green-100 text-green-700' :
                                    item.video_approval === 'Not Approved' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    Video: {item.video_approval || 'Pending'}
                                  </span>
                                  <span className={`px-2 py-1 text-xs rounded-full ${
                                    item.distribution_published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {item.distribution_published ? 'Published' : 'Not Published'}
                                  </span>
                                </div>
                              </div>
                              {/* Idea */}
                              {item.idea && (
                                <div>
                                  <h4 className="text-sm font-medium mb-1">Idea</h4>
                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-background p-3 rounded border">
                                    {item.idea}
                                  </p>
                                </div>
                              )}
                              {/* Script Preview */}
                              {item.script && (
                                <div>
                                  <h4 className="text-sm font-medium mb-1">Script</h4>
                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-background p-3 rounded border">
                                    {item.script}
                                  </p>
                                </div>
                              )}
                              {/* Production Notes */}
                              {item.production_notes && (
                                <div>
                                  <h4 className="text-sm font-medium mb-1">Production Notes</h4>
                                  <p className="text-sm text-muted-foreground">{item.production_notes}</p>
                                </div>
                              )}
                            </div>
                            {/* Right: Video Preview */}
                            <div>
                              {item.video_url ? (
                                <div>
                                  <h4 className="text-sm font-medium mb-2">Video Preview</h4>
                                  {isLocalVideo(item.video_url) ? (
                                    <video
                                      src={item.video_url}
                                      controls
                                      className="w-full rounded-lg border bg-black"
                                    />
                                  ) : (
                                    <a
                                      href={item.video_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Video className="h-4 w-4" />
                                      Open video link
                                    </a>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-32 bg-muted/50 rounded-lg border border-dashed">
                                  <span className="text-sm text-muted-foreground">No video uploaded</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-label="Production record" className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold">
                {editingItem ? `Edit #${editingItem.number}` : 'New Production'}
              </h2>
              <button disabled={saving || uploadingVideo || Boolean(translating)} onClick={closeModal} className="p-1.5 hover:bg-muted rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && <p role="alert" className="mx-4 mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            {/* Form */}
            <div className="p-4 space-y-4">
              {/* Basic Info Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Proposer</label>
                  <input
                    type="text"
                    value={formData.proposer_name}
                    onChange={(e) => setFormData({ ...formData, proposer_name: e.target.value })}
                    placeholder="Name"
                    className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Topic</label>
                  <select
                    value={formData.topic}
                    onChange={(e) => setFormData({ ...formData, topic: e.target.value as Topic })}
                    className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  >
                    {TOPICS.map((topic) => (
                      <option key={topic} value={topic}>{topic}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Idea */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    Idea
                    {formData.idea_pending && <span className="ml-2 text-xs text-red-500">(Pending Approval)</span>}
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleTranslate('idea', 'hebrew')}
                      disabled={!translationEnabled || translating === 'idea'}
                      className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50"
                      title={translationEnabled ? "Translate to Hebrew" : "Configure Gemini to enable translation"}
                    >
                      {translating === 'idea' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                      עב
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTranslate('idea', 'english')}
                      disabled={!translationEnabled || translating === 'idea'}
                      className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50"
                      title={translationEnabled ? "Translate to English" : "Configure Gemini to enable translation"}
                    >
                      {translating === 'idea' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                      EN
                    </button>
                  </div>
                </div>
                <textarea
                  value={formData.idea}
                  onChange={(e) => setFormData({ ...formData, idea: e.target.value })}
                  placeholder="Initial idea or concept..."
                  rows={4}
                  className={`w-full px-3 py-2 border rounded-lg bg-background text-sm ${formData.idea_pending ? 'border-red-300 text-red-600' : ''}`}
                />
                {/* Idea Translation Panel */}
                {ideaTranslation && (
                  <div className="mt-2 border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowIdeaTranslation(!showIdeaTranslation)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-blue-50 hover:bg-blue-100 text-sm"
                    >
                      <span className="font-medium text-blue-700">
                        Translation ({ideaTranslation.language === 'hebrew' ? 'עברית' : 'English'})
                      </span>
                      {showIdeaTranslation ? <ChevronUp className="h-4 w-4 text-blue-700" /> : <ChevronDown className="h-4 w-4 text-blue-700" />}
                    </button>
                    {showIdeaTranslation && (
                      <div className="p-3 bg-blue-50/50 text-sm whitespace-pre-wrap" dir={ideaTranslation.language === 'hebrew' ? 'rtl' : 'ltr'}>
                        {ideaTranslation.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Script */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    Script
                    {formData.script_pending && <span className="ml-2 text-xs text-red-500">(Pending Approval)</span>}
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleTranslate('script', 'hebrew')}
                      disabled={!translationEnabled || translating === 'script'}
                      className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50"
                      title={translationEnabled ? "Translate to Hebrew" : "Configure Gemini to enable translation"}
                    >
                      {translating === 'script' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                      עב
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTranslate('script', 'english')}
                      disabled={!translationEnabled || translating === 'script'}
                      className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-muted disabled:opacity-50"
                      title={translationEnabled ? "Translate to English" : "Configure Gemini to enable translation"}
                    >
                      {translating === 'script' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                      EN
                    </button>
                  </div>
                </div>
                <textarea
                  value={formData.script}
                  onChange={(e) => setFormData({ ...formData, script: e.target.value })}
                  placeholder="Full script content..."
                  rows={8}
                  className={`w-full px-3 py-2 border rounded-lg bg-background text-sm ${formData.script_pending ? 'border-red-300 text-red-600' : ''}`}
                />
                {/* Script Translation Panel */}
                {scriptTranslation && (
                  <div className="mt-2 border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowScriptTranslation(!showScriptTranslation)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-blue-50 hover:bg-blue-100 text-sm"
                    >
                      <span className="font-medium text-blue-700">
                        Translation ({scriptTranslation.language === 'hebrew' ? 'עברית' : 'English'})
                      </span>
                      {showScriptTranslation ? <ChevronUp className="h-4 w-4 text-blue-700" /> : <ChevronDown className="h-4 w-4 text-blue-700" />}
                    </button>
                    {showScriptTranslation && (
                      <div className="p-3 bg-blue-50/50 text-sm whitespace-pre-wrap" dir={scriptTranslation.language === 'hebrew' ? 'rtl' : 'ltr'}>
                        {scriptTranslation.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Script Approval */}
              <div className="flex items-center justify-between py-2 border-t">
                <span className="text-sm">Script Approval <span className="text-muted-foreground">(Reviewer)</span></span>
                <div className="flex gap-1">
                  {(['Pending', 'Approved', 'Not Approved'] as ApprovalStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => handleApproval('script_approval', status)}
                      disabled={!canApprove}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        formData.script_approval === status
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'hover:bg-muted'
                      } ${!canApprove ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Production */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Production Notes <span className="text-muted-foreground font-normal">(Production team)</span>
                </label>
                <input
                  type="text"
                  value={formData.production_notes}
                  onChange={(e) => setFormData({ ...formData, production_notes: e.target.value })}
                  placeholder="Status or notes..."
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                />
              </div>

              {/* Production Approval */}
              <div className="flex items-center justify-between py-2 border-t">
                <span className="text-sm">Production Approval <span className="text-muted-foreground">(Reviewer)</span></span>
                <div className="flex gap-1">
                  {(['Pending', 'Approved', 'Not Approved'] as ApprovalStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => handleApproval('production_approval', status)}
                      disabled={!canApprove}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        formData.production_approval === status
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'hover:bg-muted'
                      } ${!canApprove ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Upload */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  <Video className="h-4 w-4 inline mr-1" />
                  Video
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.video_url}
                    onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                    placeholder="Paste video link (YouTube, Drive, etc.)..."
                    className="flex-1 px-3 py-2 border rounded-lg bg-background text-sm"
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={handleVideoSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={uploadingVideo}
                    className="px-3 py-2 border rounded-lg hover:bg-muted text-sm flex items-center gap-1 disabled:opacity-50 min-w-[60px] justify-center"
                    title="Upload video file"
                  >
                    {uploadingVideo ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-xs">{uploadProgress}%</span>
                      </>
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {formData.video_url && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <Video className="h-4 w-4" />
                      <span className="truncate flex-1">
                        {isLocalVideo(formData.video_url)
                          ? 'Video ready for preview'
                          : formData.video_url}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, video_url: '' })}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Video Preview */}
                    {(isLocalVideo(formData.video_url)) && (
                      <video
                        src={formData.video_url}
                        controls
                        className="w-full max-h-48 rounded-lg border bg-black"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Video Approval */}
              <div className="flex items-center justify-between py-2 border-t">
                <span className="text-sm">Video Approval <span className="text-muted-foreground">(Reviewer)</span></span>
                <div className="flex gap-1">
                  {(['Pending', 'Approved', 'Not Approved'] as ApprovalStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => handleApproval('video_approval', status)}
                      disabled={!canApprove}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        formData.video_approval === status
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'hover:bg-muted'
                      } ${!canApprove ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Distribution */}
              <div className="flex items-center justify-between py-2 border-t">
                <span className="text-sm">Distribution</span>
                <button
                  type="button"
                  onClick={() => canPublish && setFormData({ ...formData, distribution_published: !formData.distribution_published })}
                  disabled={!canPublish}
                  className={`px-4 py-1.5 text-xs rounded-full border transition-colors ${
                    formData.distribution_published
                      ? 'bg-green-500 text-white border-green-500'
                      : 'hover:bg-muted'
                  } ${!canPublish ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Published
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-4 border-t bg-muted/30">
              <button
                disabled={saving || uploadingVideo || Boolean(translating)} onClick={closeModal}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                disabled={saving || uploadingVideo || Boolean(translating)} onClick={handleSubmit}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                {editingItem ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
