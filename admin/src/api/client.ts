const API_BASE = '/api/admin';

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('admin_token', token);
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('admin_token');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('admin_token');
  }

  async login(username: string, password: string): Promise<{ token: string; expiresIn: string }> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(error.error || 'Invalid credentials');
    }

    const data = await response.json();
    this.setToken(data.token);
    return data;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.clearToken();
      window.location.href = '/admin/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Dashboard
  async getStats() {
    return this.request<{
      niches: { total: number; active: number };
      discovery: { total: number; pending: number };
      jobs: { total: number; running: number };
      content: { total: number; published: number };
    }>('/stats');
  }

  // Niches
  async getNiches() {
    return this.request<Niche[]>('/niches');
  }

  async getNiche(id: string) {
    return this.request<Niche>(`/niches/${id}`);
  }

  async createNiche(data: Partial<Niche>) {
    return this.request<Niche>('/niches', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateNiche(id: string, data: Partial<Niche>) {
    return this.request<Niche>(`/niches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteNiche(id: string) {
    return this.request<{ success: boolean }>(`/niches/${id}`, {
      method: 'DELETE',
    });
  }

  // Schedules
  async getSchedules(nicheId?: string) {
    const query = nicheId ? `?nicheId=${nicheId}` : '';
    return this.request<Schedule[]>(`/schedules${query}`);
  }

  async createSchedule(data: Partial<Schedule>) {
    return this.request<Schedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSchedule(id: string, data: Partial<Schedule>) {
    return this.request<Schedule>(`/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSchedule(id: string) {
    return this.request<{ success: boolean }>(`/schedules/${id}`, {
      method: 'DELETE',
    });
  }

  // Discovery
  async getDiscoveredPosts(params: {
    nicheId?: string;
    status?: string;
    minScore?: number;
    limit?: number;
    offset?: number;
  } = {}) {
    const query = new URLSearchParams();
    if (params.nicheId) query.set('nicheId', params.nicheId);
    if (params.status) query.set('status', params.status);
    if (params.minScore) query.set('minScore', String(params.minScore));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    return this.request<{
      posts: DiscoveredPost[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(`/discovery?${query}`);
  }

  async getDiscoveredPost(id: string) {
    return this.request<DiscoveredPost>(`/discovery/${id}`);
  }

  async rejectPost(id: string, reason?: string) {
    return this.request<{ success: boolean }>(`/discovery/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async runDiscovery(scheduleId: string) {
    return this.request<unknown>(`/discovery/run/${scheduleId}`, {
      method: 'POST',
    });
  }

  async runAllDiscovery(nicheId?: string) {
    return this.request<unknown>('/discovery/run-all', {
      method: 'POST',
      body: JSON.stringify({ nicheId }),
    });
  }

  async getDiscoveryStats(nicheId?: string) {
    const query = nicheId ? `?nicheId=${nicheId}` : '';
    return this.request<{
      total: number;
      byStatus: Record<string, number>;
      avgPainScore: number;
      highValuePosts: number;
    }>(`/discovery/stats${query}`);
  }

  // Jobs
  async getJobs(params: {
    nicheId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const query = new URLSearchParams();
    if (params.nicheId) query.set('nicheId', params.nicheId);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    return this.request<{
      jobs: Job[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(`/jobs?${query}`);
  }

  async getJob(id: string) {
    return this.request<Job>(`/jobs/${id}`);
  }

  async createJob(discoveredPostId: string) {
    return this.request<Job>('/jobs', {
      method: 'POST',
      body: JSON.stringify({ discoveredPostId }),
    });
  }

  async startJob(id: string) {
    return this.request<{ success: boolean }>(`/jobs/${id}/start`, {
      method: 'POST',
    });
  }

  async retryJob(id: string) {
    return this.request<{ success: boolean }>(`/jobs/${id}/retry`, {
      method: 'POST',
    });
  }

  async cancelJob(id: string) {
    return this.request<{ success: boolean }>(`/jobs/${id}/cancel`, {
      method: 'POST',
    });
  }

  // Content
  async getContent(params: {
    nicheId?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const query = new URLSearchParams();
    if (params.nicheId) query.set('nicheId', params.nicheId);
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    return this.request<{
      content: Content[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(`/content?${query}`);
  }

  async getContentItem(id: string) {
    return this.request<Content>(`/content/${id}`);
  }

  async createContent(data: { nicheId: string; title: string; slug?: string; description?: string; content: string }) {
    return this.request<Content>('/content', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateContent(id: string, data: Partial<Content>) {
    return this.request<Content>(`/content/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async approveContent(id: string) {
    return this.request<{ success: boolean }>(`/content/${id}/approve`, {
      method: 'POST',
    });
  }

  async publishContent(id: string) {
    return this.request<{ success: boolean; url?: string }>(`/content/${id}/publish`, {
      method: 'POST',
    });
  }

  async unpublishContent(id: string) {
    return this.request<{ success: boolean }>(`/content/${id}/unpublish`, {
      method: 'POST',
    });
  }

  async deleteContent(id: string) {
    return this.request<{ success: boolean }>(`/content/${id}`, {
      method: 'DELETE',
    });
  }

  async validateContent(id: string) {
    return this.request<{
      isValid: boolean;
      seo: { passed: boolean; score: number };
      slop: { passed: boolean; score: number };
      suggestions: string[];
    }>(`/content/${id}/validate`, {
      method: 'POST',
    });
  }

  async chatWithContent(
    id: string,
    data: {
      message: string;
      currentContent?: string;
      conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
      includePreview?: boolean;
    }
  ) {
    return this.request<{
      response: string;
      explanation: string | null;
      diff: string | null;
      updatedContent: string | null;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    }>('/content/' + id + '/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getContentPreview(id: string) {
    return this.request<{
      html: string;
      componentStatus: ComponentGenerationResult[] | null;
    }>('/content/' + id + '/preview');
  }

  async regenerateComponent(id: string, componentType: string) {
    return this.request<{
      success: boolean;
      component?: {
        id: string;
        type: string;
        name: string;
        code: string;
      };
      error?: string;
      status: ComponentGenerationResult;
    }>('/content/' + id + '/components/regenerate', {
      method: 'POST',
      body: JSON.stringify({ componentType }),
    });
  }

  // Settings
  async getSettings(nicheId?: string) {
    const query = nicheId ? `?nicheId=${nicheId}` : '';
    return this.request<{
      global: Record<string, string>;
      niche: Record<string, string> | null;
    }>(`/settings${query}`);
  }

  async setSetting(key: string, value: string, nicheId?: string) {
    return this.request<unknown>(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, nicheId }),
    });
  }

  async getAiUsage() {
    return this.request<{
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      requestCount: number;
      byModel: Record<string, { inputTokens: number; outputTokens: number; requestCount: number }>;
    }>('/settings/ai/usage');
  }

  async getSchedulerStatus() {
    return this.request<{
      jobs: Array<{ name: string; cronExpression: string; nextRun: string | null }>;
    }>('/settings/scheduler/status');
  }

  async reloadScheduler() {
    return this.request<{
      success: boolean;
      jobs: Array<{ name: string; cronExpression: string; nextRun: string | null }>;
    }>('/settings/scheduler/reload', { method: 'POST' });
  }
}

export const api = new ApiClient();

// Types
export interface Niche {
  id: string;
  name: string;
  slug: string;
  description?: string;
  voiceGuidelines?: string;
  targetAudience?: string;
  keywords?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  nicheId: string;
  sourceType: string;
  config: string;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredPost {
  id: string;
  nicheId: string;
  scheduleId?: string;
  sourceType: string;
  sourceUrl: string;
  sourceId?: string;
  title: string;
  content: string;
  author?: string;
  authorLevel?: string;
  metadata?: string;
  painScore?: number;
  painAnalysis?: string;
  status: string;
  rejectionReason?: string;
  contentHash: string;
  discoveredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  discoveredPostId: string;
  nicheId: string;
  status: string;
  currentStep?: string;
  progress: number;
  voiceAnalysis?: string;
  research?: string;
  outline?: string;
  errorMessage?: string;
  errorStack?: string;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Content {
  id: string;
  nicheId: string;
  jobId?: string;
  discoveredPostId?: string;
  slug: string;
  title: string;
  description?: string;
  content: string;
  components?: string;
  componentBundle?: string;
  componentStatus?: string;
  seoScore?: number;
  seoAnalysis?: string;
  slopScore?: number;
  slopAnalysis?: string;
  status: string;
  reviewNotes?: string;
  publishedAt?: string;
  publishedUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentSpec {
  type: string;
  purpose: string;
  placement: string;
  requirements: string[];
}

export interface ComponentGenerationResult {
  success: boolean;
  component?: {
    id: string;
    type: string;
    name: string;
    code: string;
    props: Record<string, unknown>;
    exports: string[];
  };
  spec: ComponentSpec;
  error?: string;
  attempts: number;
}
