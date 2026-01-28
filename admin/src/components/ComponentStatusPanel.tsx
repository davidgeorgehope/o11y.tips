import { useState } from 'react';
import { api, ComponentGenerationResult } from '../api/client';

interface ComponentStatusPanelProps {
  contentId: string;
  componentStatus: ComponentGenerationResult[] | null;
  onStatusChange: () => void;
}

export default function ComponentStatusPanel({
  contentId,
  componentStatus,
  onStatusChange,
}: ComponentStatusPanelProps) {
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async (componentType: string) => {
    setRegenerating(componentType);
    setError(null);

    try {
      const result = await api.regenerateComponent(contentId, componentType);
      if (result.success) {
        onStatusChange();
      } else {
        setError(result.error || 'Regeneration failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate component');
    } finally {
      setRegenerating(null);
    }
  };

  if (!componentStatus || componentStatus.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-3">Component Status</h3>
        <p className="text-sm text-gray-500">
          No component status available. This content may have been created before component tracking was enabled.
        </p>
      </div>
    );
  }

  const successCount = componentStatus.filter(s => s.success).length;
  const failedCount = componentStatus.filter(s => !s.success).length;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold mb-3">Component Status</h3>

      <div className="flex gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          <span>{successCount} succeeded</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          <span>{failedCount} failed</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded text-sm mb-4">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        {componentStatus.map((status, index) => (
          <div
            key={index}
            className={'border rounded-lg p-3 ' + (status.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={'px-2 py-0.5 rounded text-xs font-medium ' + (status.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                    {status.spec.type}
                  </span>
                  <span className={'text-xs ' + (status.success ? 'text-green-600' : 'text-red-600')}>
                    {status.success ? 'Generated' : 'Failed'}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{status.spec.purpose}</p>
                <p className="text-xs text-gray-400 mt-1">Placement: {status.spec.placement}</p>
                <p className="text-xs text-gray-400">Attempts: {status.attempts}</p>
                {!status.success && status.error && (
                  <p className="text-xs text-red-600 mt-2">
                    Error: {status.error}
                  </p>
                )}
                {status.spec.requirements.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-500 font-medium">Requirements:</p>
                    <ul className="text-xs text-gray-500 list-disc list-inside">
                      {status.spec.requirements.slice(0, 3).map((req, i) => (
                        <li key={i}>{req}</li>
                      ))}
                      {status.spec.requirements.length > 3 && (
                        <li>...and {status.spec.requirements.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              {!status.success && (
                <button
                  onClick={() => handleRegenerate(status.spec.type)}
                  disabled={regenerating === status.spec.type}
                  className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {regenerating === status.spec.type ? (
                    <>
                      <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span>
                      Retrying...
                    </>
                  ) : (
                    'Retry'
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
