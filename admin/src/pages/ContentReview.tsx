import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, Content } from '../api/client';

export default function ContentReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [content, setContent] = useState<Content | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [validation, setValidation] = useState<{
    isValid: boolean;
    seo: { passed: boolean; score: number };
    slop: { passed: boolean; score: number };
    suggestions: string[];
  } | null>(null);

  useEffect(() => {
    if (id) {
      loadContent();
    }
  }, [id]);

  const loadContent = async () => {
    try {
      const data = await api.getContentItem(id!);
      setContent(data);
      setEditContent(data.content);
    } catch (err) {
      setError('Failed to load content');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!content) return;
    setSaving(true);
    try {
      await api.updateContent(content.id, { content: editContent });
      setContent({ ...content, content: editContent });
      setEditMode(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    if (!content) return;
    try {
      const result = await api.validateContent(content.id);
      setValidation(result);
      loadContent(); // Reload to get updated scores
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to validate');
    }
  };

  const handleApprove = async () => {
    if (!content) return;
    try {
      await api.approveContent(content.id);
      navigate('/content');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handlePublish = async () => {
    if (!content) return;
    try {
      const result = await api.publishContent(content.id);
      if (result.url) {
        alert(`Published at: ${result.url}`);
      }
      navigate('/content');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!content) {
    return <div className="text-red-600">Content not found</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold">{content.title}</h1>
          <p className="text-gray-500">{content.description}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleValidate}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Validate
          </button>
          {content.status === 'review' && (
            <button
              onClick={handleApprove}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Approve
            </button>
          )}
          {content.status === 'approved' && (
            <button
              onClick={handlePublish}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Publish
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Content Editor/Preview */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow">
          <div className="border-b px-4 py-3 flex justify-between items-center">
            <h2 className="font-semibold">Content</h2>
            <button
              onClick={() => setEditMode(!editMode)}
              className="text-sm text-blue-600 hover:underline"
            >
              {editMode ? 'Preview' : 'Edit'}
            </button>
          </div>
          <div className="p-4">
            {editMode ? (
              <>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-[600px] font-mono text-sm p-4 border border-gray-300 rounded-lg"
                />
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => { setEditContent(content.content); setEditMode(false); }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="prose max-w-none">
                <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg overflow-auto max-h-[600px]">
                  {content.content}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Status</h3>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-gray-500">Status:</span>{' '}
                <span className="capitalize font-medium">{content.status}</span>
              </p>
              <p>
                <span className="text-gray-500">Created:</span>{' '}
                {new Date(content.createdAt).toLocaleString()}
              </p>
              {content.publishedAt && (
                <p>
                  <span className="text-gray-500">Published:</span>{' '}
                  {new Date(content.publishedAt).toLocaleString()}
                </p>
              )}
              {content.publishedUrl && (
                <p>
                  <span className="text-gray-500">URL:</span>{' '}
                  <a href={content.publishedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    View
                  </a>
                </p>
              )}
            </div>
          </div>

          {/* Quality Scores */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Quality Scores</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>SEO Score</span>
                  <span className={content.seoScore !== undefined && content.seoScore !== null && content.seoScore >= 70 ? 'text-green-600' : 'text-yellow-600'}>
                    {content.seoScore?.toFixed(0) || 'N/A'}
                  </span>
                </div>
                {content.seoScore !== undefined && content.seoScore !== null && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${content.seoScore >= 70 ? 'bg-green-500' : 'bg-yellow-500'}`}
                      style={{ width: `${content.seoScore}%` }}
                    />
                  </div>
                )}
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Slop Score</span>
                  <span className={content.slopScore !== undefined && content.slopScore !== null && content.slopScore <= 5 ? 'text-green-600' : 'text-yellow-600'}>
                    {content.slopScore?.toFixed(1) || 'N/A'}
                  </span>
                </div>
                {content.slopScore !== undefined && content.slopScore !== null && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${content.slopScore <= 5 ? 'bg-green-500' : 'bg-yellow-500'}`}
                      style={{ width: `${Math.min(100, content.slopScore * 10)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Validation Results */}
          {validation && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Validation Results</h3>
              <div className={`px-3 py-2 rounded mb-3 ${validation.isValid ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                {validation.isValid ? 'Content is ready for publishing' : 'Content needs improvements'}
              </div>
              {validation.suggestions.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Suggestions:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {validation.suggestions.map((s, i) => (
                      <li key={i}>- {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* SEO Analysis */}
          {content.seoAnalysis && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">SEO Analysis</h3>
              <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-48">
                {JSON.stringify(JSON.parse(content.seoAnalysis), null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
