import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

const baseURL = '/api';

const instance: AxiosInstance = axios.create({
  baseURL,
  timeout: 15000,
});

instance.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('website_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

instance.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.success === false) {
        if (!(res.config as any)?.silent) {
          ElMessage.error(body.error || '请求失败');
        }
        return Promise.reject(new Error(body.error || 'request failed'));
      }
      res.data = body.data;
      return res;
    }
    return res;
  },
  (err) => {
    const silent = (err?.config as any)?.silent;
    if (!silent) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error;
      if (status === 401) {
        // 登录失败 / 凭证失效等：优先用后端的友好提示（如"账号或密码错误"）
        ElMessage.error(serverMsg || '登录状态已失效，请重新登录');
      } else {
        ElMessage.error(serverMsg || err.message || '请求失败');
      }
    }
    return Promise.reject(err);
  },
);

/** 业务封装：直接返回 data */
export const http = {
  get<T = any>(url: string, config?: AxiosRequestConfig) {
    return instance.get<any, { data: T }>(url, config).then((r) => r.data);
  },
  post<T = any>(url: string, body?: any, config?: AxiosRequestConfig) {
    return instance.post<any, { data: T }>(url, body, config).then((r) => r.data);
  },
  put<T = any>(url: string, body?: any, config?: AxiosRequestConfig) {
    return instance.put<any, { data: T }>(url, body, config).then((r) => r.data);
  },
  patch<T = any>(url: string, body?: any, config?: AxiosRequestConfig) {
    return instance.patch<any, { data: T }>(url, body, config).then((r) => r.data);
  },
  delete<T = any>(url: string, config?: AxiosRequestConfig) {
    return instance.delete<any, { data: T }>(url, config).then((r) => r.data);
  },
};

export default http;
