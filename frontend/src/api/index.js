import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Set auth header from storage on startup
const token = localStorage.getItem('accessToken');
if (token) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes('/auth/login')
    ) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const res = await axios.post('/api/auth/refresh', { refreshToken });
        const { accessToken, refreshToken: newRefresh } = res.data;
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', newRefresh);
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default api;

export const getFolders = () => api.get('/folders');
export const createFolder = (data) => api.post('/folders', data);
export const updateFolder = (id, data) => api.put(`/folders/${id}`, data);
export const deleteFolder = (id) => api.delete(`/folders/${id}`);
