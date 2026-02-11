import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Niche } from '../api/client';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

export default function CreateContent() {
  const navigate = useNavigate();
  const [niches, setNiches] = useState<Niche[]>([]);
  const [nicheId, setNicheId] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugLocked, setSlugLocked] = useState(false);
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadingNiches, setLoadingNiches] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getNiches()
      .then((data) => {
        setNiches(data);
        if (data.length > 0) setNicheId(data[0].id);
      })
      .catch(() => setError('Failed to load niches'))
      .finally(() => setLoadingNiches(false));
  }, []);

  useEffect(() => {
    if (!slugLocked) {
      setSlug(slugify(title));
    }
  }, [title, slugLocked]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nicheId || !title.trim() || !content.trim()) {
      setError('Niche, title, and content are required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const created = await api.createContent({
        nicheId,
        title: title.trim(),
        slug: slug || undefined,
        description: description.trim() || undefined,
        content: content,
      });
      navigate(`/content/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create content');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  if (loadingNiches) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Article</h1>
        <p className="text-gray-500 mt-1">Write a new article manually. After saving, you can validate SEO, preview, and publish from the review page.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-3 gap-6">
          {/* Main editor - 2 columns */}
          <div className="col-span-2 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Slug
                <button
                  type="button"
                  onClick={() => setSlugLocked(!slugLocked)}
                  className="ml-2 text-xs text-blue-600 hover:text-blue-800"
                >
                  {slugLocked ? 'unlock (auto-generate)' : 'lock (edit manually)'}
                </button>
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                readOnly={!slugLocked}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  !slugLocked ? 'bg-gray-50 text-gray-500' : ''
                }`}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description for SEO meta tags"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Content (Markdown)</label>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write your article in Markdown..."
                rows={28}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                required
              />
            </div>
          </div>

          {/* Right sidebar - 1 column */}
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Niche</label>
              <select
                value={nicheId}
                onChange={(e) => setNicheId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>

              <button
                type="submit"
                disabled={saving || !title.trim() || !content.trim()}
                className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
              <h3 className="font-medium text-gray-900 mb-2">Tips</h3>
              <ul className="space-y-1.5">
                <li><code className="text-xs bg-gray-200 px-1 rounded"># H1</code> <code className="text-xs bg-gray-200 px-1 rounded">## H2</code> headings</li>
                <li><code className="text-xs bg-gray-200 px-1 rounded">**bold**</code> <code className="text-xs bg-gray-200 px-1 rounded">*italic*</code></li>
                <li><code className="text-xs bg-gray-200 px-1 rounded">```lang</code> for code blocks</li>
                <li><code className="text-xs bg-gray-200 px-1 rounded">- item</code> for lists</li>
                <li><code className="text-xs bg-gray-200 px-1 rounded">[text](url)</code> for links</li>
              </ul>
              <hr className="my-3 border-gray-200" />
              <p>After saving, the review page provides SEO/GEO validation, AI editing, interactive components, and preview.</p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
              <h3 className="font-medium text-gray-900 mb-2">Word count</h3>
              <p className="text-lg font-mono">{content.trim() ? content.trim().split(/\s+/).length : 0} words</p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
