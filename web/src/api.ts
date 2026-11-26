async function request<T>(path: string, method = 'GET', body?: object, revision?: number): Promise<T> {
  const headers: Record<string, string> = { 'X-Production-Desk': '1' }
  if (body) headers['Content-Type'] = 'application/json'
  if (revision !== undefined) headers['If-Match'] = String(revision)
  const response = await fetch('/api/' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Check your entries and try again.')
  }
  return response.json()
}

export const getProductions = () => request<{productions: unknown[]; role: string; translation_enabled: boolean}>('productions')
export const createProduction = (data: object) => request('productions', 'POST', data)
export const updateProduction = (id: string, revision: number, data: object) => request('productions/' + id, 'PUT', data, revision)
export const deleteProduction = (id: string, revision: number) => request('productions/' + id, 'DELETE', undefined, revision)
export const translateText = (text: string, target: string) => request<{translated_text: string}>('translate', 'POST', {text, target})

export function uploadFile(file: File, onProgress: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media')
    xhr.setRequestHeader('X-Production-Desk', '1')
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total * 100)
    }
    xhr.responseType = 'json'
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response.url)
      else reject(new Error(xhr.response?.detail || 'Upload failed'))
    }
    xhr.onerror = () => reject(new Error('Upload interrupted. Please try again.'))
    xhr.send(file)
  })
}
