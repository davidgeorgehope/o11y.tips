import { useState, useEffect } from 'react';
import { api, DiscoveredPost, Niche } from '../api/client';

export default function Discovery() {
  const [posts, setPosts] = useState<DiscoveredPost[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    nicheId: '',
    status: 'pending',
    minScore: 0,
  });
  const [pagination, setPagination] = useState({
    total: 0,
    offset: 0,
    limit: 20,
  });
  const [selectedPost, setSelectedPost] = useState<DiscoveredPost | null>(null);

  useEffect(() => {
    loadNiches();
  }, []);

  useEffect(() => {
    loadPosts();
  }, [filters, pagination.offset]);

  const loadNiches = async () => {
    try {
      const data = await api.getNiches();
      setNiches(data);
    } catch (err) {
      console.error('Failed to load niches', err);
    }
  };

  const loadPosts = async () => {
    setLoading(true);
    try {
      const data = await api.getDiscoveredPosts({
        ...filters,
        minScore: filters.minScore || undefined,
        nicheId: filters.nicheId || undefined,
        limit: pagination.limit,
        offset: pagination.offset,
      });
      setPosts(data.posts);
      setPagination(prev => ({ ...prev, total: data.pagination.total }));
    } catch (err) {
      setError('Failed to load posts');
    } finally {
      setLoading(false);
    }
  };

  const handleQueue = async (postId: string) => {
    try {
      await api.createJob(postId);
      loadPosts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to queue post');
    }
  };

  const handleReject = async (postId: string) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      await api.rejectPost(postId, reason || undefined);
      loadPosts();
      setSelectedPost(null);
    } catch (err) {
      setError('Failed to reject post');
    }
  };

  const handleRunAllDiscovery = async () => {
    try {
      await api.runAllDiscovery(filters.nicheId || undefined);
      alert('Discovery started for all schedules!');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run discovery');
    }
  };

  const getNicheName = (nicheId: string) => {
    return niches.find(n => n.id === nicheId)?.name || 'Unknown';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Discovery Queue</h1>
        <button
          onClick={handleRunAllDiscovery}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Run All Discovery
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Niche</label>
            <select
              value={filters.nicheId}
              onChange={(e) => setFilters({ ...filters, nicheId: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All Niches</option>
              {niches.map(niche => (
                <option key={niche.id} value={niche.id}>{niche.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="queued">Queued</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Pain Score</label>
            <input
              type="number"
              value={filters.minScore}
              onChange={(e) => setFilters({ ...filters, minScore: parseInt(e.target.value) || 0 })}
              className="w-24 px-4 py-2 border border-gray-300 rounded-lg"
              min="0"
              max="100"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Posts List */}
        <div className="flex-1 bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Score
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {posts.map(post => (
                    <tr
                      key={post.id}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        selectedPost?.id === post.id ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => setSelectedPost(post)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 truncate max-w-xs">
                          {post.title}
                        </div>
                        <div className="text-xs text-gray-500">
                          {getNicheName(post.nicheId)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-sm font-medium ${
                          (post.painScore || 0) >= 70
                            ? 'bg-green-100 text-green-700'
                            : (post.painScore || 0) >= 50
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {post.painScore?.toFixed(0) || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 capitalize">
                        {post.sourceType.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          post.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          post.status === 'queued' ? 'bg-blue-100 text-blue-700' :
                          post.status === 'completed' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {post.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {post.status === 'pending' && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleQueue(post.id); }}
                              className="text-sm text-blue-600 hover:underline mr-2"
                            >
                              Queue
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReject(post.id); }}
                              className="text-sm text-red-600 hover:underline"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="px-4 py-3 border-t flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  Showing {pagination.offset + 1} - {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPagination(p => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}
                    disabled={pagination.offset === 0}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPagination(p => ({ ...p, offset: p.offset + p.limit }))}
                    disabled={pagination.offset + pagination.limit >= pagination.total}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Post Detail */}
        {selectedPost && (
          <div className="w-96 bg-white rounded-lg shadow p-4 h-fit sticky top-4">
            <h3 className="font-semibold mb-2">{selectedPost.title}</h3>
            <div className="text-sm text-gray-500 mb-4 space-y-1">
              <p>Source: <a href={selectedPost.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{selectedPost.sourceType}</a></p>
              <p>Author: {selectedPost.author || 'Unknown'}</p>
              <p>Level: {selectedPost.authorLevel || 'Unknown'}</p>
              <p>Pain Score: {selectedPost.painScore?.toFixed(1) || 'N/A'}</p>
            </div>
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-2">Content</h4>
              <div className="text-sm text-gray-600 max-h-64 overflow-y-auto whitespace-pre-wrap">
                {selectedPost.content}
              </div>
            </div>
            {selectedPost.painAnalysis && (
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium mb-2">Pain Analysis</h4>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                  {JSON.stringify(JSON.parse(selectedPost.painAnalysis), null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
