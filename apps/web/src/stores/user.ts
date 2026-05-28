import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import api from '@/api';

export interface UserProfile {
  id: number;
  username: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  balance: string | number;
  role: 'USER' | 'ADMIN';
}

export const useUserStore = defineStore('user', () => {
  const token = ref<string | null>(localStorage.getItem('website_token'));
  const profile = ref<UserProfile | null>(null);

  const isLoggedIn = computed(() => !!token.value);

  function setToken(t: string | null) {
    token.value = t;
    if (t) localStorage.setItem('website_token', t);
    else localStorage.removeItem('website_token');
  }

  async function restore() {
    if (!token.value) return;
    try {
      profile.value = await api.profile();
    } catch {
      setToken(null);
      profile.value = null;
    }
  }

  async function login(payload: {
    username: string;
    password: string;
    captchaId: string;
    captchaCode: string;
  }) {
    const r = await api.login(payload);
    setToken(r.token);
    await restore();
  }

  async function register(payload: {
    username: string;
    password: string;
    email?: string;
    nickname?: string;
    captchaId: string;
    captchaCode: string;
  }) {
    const r = await api.register(payload);
    setToken(r.token);
    await restore();
  }

  function logout() {
    setToken(null);
    profile.value = null;
  }

  return { token, profile, isLoggedIn, login, register, logout, restore };
});
