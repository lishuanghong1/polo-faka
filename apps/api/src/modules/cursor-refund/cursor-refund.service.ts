import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptString, isEncrypted } from '../../common/crypto.util';

/**
 * Cursor「团队邀请按比例退款」链（移植自 CursorManager CursorApi.OneClickRefundAsync）。
 * 纯 HTTP，无浏览器：
 *   owner get-team-invite-link → 目标 accept-invite（触发退款）
 *   → owner remove-member 踢出 → 轮询 /api/auth/stripe 到 membershipType=free
 *
 * 配置（站点设置）：
 *   cursor_refund_enabled     开关（'true'/'1'）
 *   cursor_refund_owner_token  团队 owner 的 token（加密存储）
 *   cursor_refund_team_id      团队 ID
 */

const BASE = 'https://cursor.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const TIMEOUT = 30000;

const K_ENABLED = 'cursor_refund_enabled';
const K_OWNER = 'cursor_refund_owner_token';
const K_TEAM = 'cursor_refund_team_id';

export interface RefundResult {
  ok: boolean;
  email: string;
  amount: number;          // 美元
  prevMembership: string;
  finalMembership: string;
  error?: string;
  log: string[];
}

/** user_xxx::JWT / %3A%3A → :: */
function normalizeToken(raw: string): string {
  let t = (raw || '').trim();
  const idx = t.indexOf('WorkosCursorSessionToken=');
  if (idx >= 0) {
    t = t.slice(idx + 'WorkosCursorSessionToken='.length);
    const semi = t.indexOf(';');
    if (semi >= 0) t = t.slice(0, semi);
    t = t.trim();
  }
  if (t.includes('%')) {
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep */
    }
  }
  return t.trim();
}

function jwtOf(token: string): string {
  const i = token.indexOf('::');
  return i >= 0 ? token.slice(i + 2) : token;
}

@Injectable()
export class CursorRefundService {
  private readonly logger = new Logger(CursorRefundService.name);

  constructor(private prisma: PrismaService) {}

  private async readSetting(key: string): Promise<string> {
    const row = await this.prisma.siteSetting.findUnique({ where: { key } });
    if (!row?.value) return '';
    if (key === K_OWNER && isEncrypted(row.value)) {
      try {
        return decryptString(row.value);
      } catch {
        return '';
      }
    }
    return row.value.trim();
  }

  /** 是否已启用且配置完整（owner token + teamId 都在） */
  async getConfig(): Promise<{ enabled: boolean; ownerToken: string; teamId: number }> {
    const [enabledRaw, ownerRaw, teamRaw] = await Promise.all([
      this.readSetting(K_ENABLED),
      this.readSetting(K_OWNER),
      this.readSetting(K_TEAM),
    ]);
    const ownerToken = normalizeToken(ownerRaw);
    const teamId = Number(teamRaw) || 0;
    const enabled = (enabledRaw === 'true' || enabledRaw === '1') && !!ownerToken && teamId > 0;
    return { enabled, ownerToken, teamId };
  }

  async isReady(): Promise<boolean> {
    return (await this.getConfig()).enabled;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: any,
    api2 = false,
  ): Promise<any> {
    const url = (api2 ? 'https://api2.cursor.sh' : BASE) + path;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: '*/*',
    };
    if (api2) {
      headers['Authorization'] = `Bearer ${jwtOf(token)}`;
      headers['Connect-Protocol-Version'] = '1';
    } else {
      headers['Cookie'] = `WorkosCursorSessionToken=${encodeURIComponent(token)}`;
      headers['Origin'] = BASE;
      headers['Referer'] = `${BASE}/dashboard`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const resp = await axios.request({
      method,
      url,
      timeout: TIMEOUT,
      validateStatus: (s) => s < 500,
      headers,
      data: body !== undefined ? JSON.stringify(body) : undefined,
      transformRequest: [(d) => d],
    });
    return resp.data;
  }

  private async fillMe(token: string): Promise<{ userId: number; email: string }> {
    const e = await this.request('GET', '/api/auth/me', token);
    return { userId: Number(e?.id) || 0, email: String(e?.email || '') };
  }

  private async membership(token: string): Promise<string> {
    const e = await this.request('GET', '/api/auth/stripe', token);
    return String(e?.membershipType || '');
  }

  private async previewRefundUsd(token: string): Promise<number> {
    try {
      const e = await this.request('POST', '/api/dashboard/preview-new-team-checkout', token, {
        seats: 1,
        yearly: false,
        includeBugbot: false,
      });
      const cents = Number(e?.prorationCreditCents);
      return Number.isFinite(cents) ? cents / 100 : 0;
    } catch {
      return 0;
    }
  }

  private async getInviteCode(ownerToken: string, teamId: number): Promise<string> {
    const e = await this.request('POST', '/api/dashboard/get-team-invite-link', ownerToken, { teamId });
    const link = String(e?.inviteLink || '');
    const idx = link.indexOf('code=');
    return idx >= 0 ? link.slice(idx + 5) : '';
  }

  /** 从 owner token 自动检测它拥有的第一个团队 id（配置的 teamId 过期/不对时兜底）。 */
  private async detectTeamId(ownerToken: string): Promise<number> {
    try {
      const e = await this.request('POST', '/api/dashboard/teams', ownerToken, { activeOnly: false });
      const teams: any[] = Array.isArray(e?.teams) ? e.teams : [];
      const owned = teams.find((t) => t?.role === 'TEAM_ROLE_OWNER' && Number(t?.id) > 0);
      if (owned) return Number(owned.id);
      const first = teams.find((t) => Number(t?.id) > 0);
      return first ? Number(first.id) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * 拿邀请码：先用配置的 teamId；拿不到（团队 id 过期/无权限）时，
   * 自动检测 owner 名下的团队再试一次。返回实际生效的 teamId + code。
   */
  private async resolveInvite(
    ownerToken: string,
    teamId: number,
  ): Promise<{ code: string; teamId: number; detected?: number }> {
    let code = teamId > 0 ? await this.getInviteCode(ownerToken, teamId) : '';
    if (code) return { code, teamId };
    const detected = await this.detectTeamId(ownerToken);
    if (detected && detected !== teamId) {
      code = await this.getInviteCode(ownerToken, detected);
      if (code) return { code, teamId: detected, detected };
    }
    return { code: '', teamId, detected: detected || undefined };
  }

  /**
   * 对单个目标账号执行退款。
   * @param targetTokenRaw 目标账号的 cursor token（原始/编码均可）
   */
  async refundOne(targetTokenRaw: string): Promise<RefundResult> {
    const log: string[] = [];
    const L = (m: string) => {
      log.push(m);
      this.logger.log(`[refund] ${m}`);
    };
    const res: RefundResult = { ok: false, email: '', amount: 0, prevMembership: '', finalMembership: '', log };

    const target = normalizeToken(targetTokenRaw);
    if (!target) {
      res.error = '缺少目标账号 token';
      return res;
    }
    const { enabled, ownerToken, teamId } = await this.getConfig();
    if (!enabled) {
      res.error = '自动退款未启用或未配置 owner token / teamId';
      return res;
    }

    try {
      const me = await this.fillMe(target);
      res.email = me.email;

      res.prevMembership = await this.membership(target);
      if (res.prevMembership === 'free') {
        res.ok = true;
        res.finalMembership = 'free';
        L('账号已是 free，无需退款');
        return res;
      }

      if (!me.userId) {
        res.error = '获取账号 userId 失败（token 可能已失效）';
        return res;
      }
      L(`目标账号 ${me.email} (userId=${me.userId})`);

      res.amount = await this.previewRefundUsd(target);

      const { code, teamId: effectiveTeamId, detected } = await this.resolveInvite(ownerToken, teamId);
      if (!code) {
        res.error =
          '获取团队邀请码失败（检查 owner token / teamId）' +
          (detected ? `；owner 名下检测到团队 ${detected}，但仍拿不到邀请码` : '；owner 名下未检测到任何团队');
        return res;
      }
      if (effectiveTeamId !== teamId) {
        L(`配置的 teamId=${teamId} 无效，自动改用 owner 名下团队 ${effectiveTeamId}`);
      }

      const acc = await this.request('POST', '/api/accept-invite', target, { inviteCode: code });
      if (JSON.stringify(acc ?? '').toLowerCase().includes('"error"')) {
        res.error = '加入团队失败：' + JSON.stringify(acc).slice(0, 200);
        return res;
      }
      L('已加入团队，退款已触发');

      await new Promise((r) => setTimeout(r, 2000));
      await this.request('POST', '/api/dashboard/remove-member', ownerToken, {
        teamId: effectiveTeamId,
        userId: me.userId,
      });
      L('已踢出团队');

      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const m = await this.membership(target);
        res.finalMembership = m;
        L(`检测状态：membership=${m}`);
        if (m === 'free') {
          res.ok = true;
          L('账号已变 Free，退款完成');
          break;
        }
      }
      if (!res.ok) res.error = `退款后账号仍为 ${res.finalMembership || '未知'}`;
      return res;
    } catch (e) {
      res.error = (e as Error)?.message || '退款异常';
      this.logger.warn(`refundOne failed: ${res.error}`);
      return res;
    }
  }

  /** 查账号订阅类型 + 用量（不退款，供详情展示）。移植自 CursorManager FillUsageAndDevices。 */
  async getAccountInfo(rawToken: string): Promise<{
    ok: boolean;
    email?: string;
    membershipType?: string;
    usagePercent?: number | null;
    usageText?: string;
    error?: string;
  }> {
    const token = normalizeToken(rawToken);
    if (!token) return { ok: false, error: '缺少 token' };
    try {
      const me = await this.fillMe(token);
      const membershipType = await this.membership(token);
      let usagePercent: number | null = null;
      let usageText = '';
      try {
        const pu = await this.request('POST', '/api/dashboard/get-current-period-usage', token, {});
        const p = pu?.planUsage;
        if (p) {
          const total = Number(p.totalPercentUsed) || 0;
          const api = Number(p.apiPercentUsed) || 0;
          const auto = Number(p.autoPercentUsed) || 0;
          usagePercent = total;
          usageText = `已用 ${total.toFixed(1)}%（Auto ${auto.toFixed(1)}% · API ${api.toFixed(1)}%）`;
        }
      } catch {
        /* 用量拿不到不影响 */
      }
      if (!me.userId && !membershipType) {
        return { ok: false, error: 'token 可能已失效' };
      }
      return { ok: true, email: me.email, membershipType, usagePercent, usageText };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || '查询失败' };
    }
  }

  /** 手动批量退款：逐个执行（退款较慢，串行更稳），返回每个的结果 */
  async refundMany(tokens: string[]): Promise<RefundResult[]> {
    const list = Array.from(
      new Set((tokens || []).map((t) => (t || '').trim()).filter(Boolean)),
    );
    const out: RefundResult[] = [];
    for (const t of list) {
      out.push(await this.refundOne(t));
    }
    return out;
  }
}
