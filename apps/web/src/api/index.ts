import http from './http';

/**
 * 退款链在服务端同步串行执行（团队邀请→接受→踢出→轮询到 free，每个号约 30–40s，
 * 批量按数量叠加），默认 15s 会请求超时。给退款相关接口放宽到 5 分钟。
 */
const REFUND_TIMEOUT = 5 * 60 * 1000;

export type AdminUserDetail = {
  user: {
    id: number;
    username: string;
    email: string | null;
    nickname: string | null;
    avatar: string | null;
    role: 'USER' | 'ADMIN';
    status: 'ACTIVE' | 'BANNED';
    balance: string;
    points: number;
    inviteCode: string | null;
    inviter: { id: number; username: string; nickname: string | null } | null;
    totalRecharged: string;
    vipTier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
    customDiscount: number | null;
    vipUpgradedAt: string | null;
    createdAt: string;
    lastLogin: string | null;
  };
  wallet: {
    balance: number;
    points: number;
    inviteCode: string | null;
    inviter: { id: number; username: string; nickname: string | null } | null;
    totalRecharged: number;
    vipTier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
    customDiscount: number | null;
    vipUpgradedAt: string | null;
    paidRechargeCount: number;
    paidRechargeSum: number;
  };
  rechargeOrders: Array<{
    orderNo: string;
    amount: number;
    status: 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
    payMethod: string;
    thirdTradeNo: string | null;
    buyerLogonId: string | null;
    paidAt: string | null;
    expireAt: string;
    createdAt: string;
  }>;
  balanceLogs: Array<{
    id: number;
    amount: number;
    balance: number;
    type: 'RECHARGE' | 'CONSUME' | 'REFUND' | 'ADJUST';
    note: string | null;
    refOrder: string | null;
    createdAt: string;
  }>;
  pointLogs: Array<{
    id: number;
    amount: number;
    balance: number;
    type: 'ORDER_REWARD' | 'INVITE_REWARD' | 'ORDER_DEDUCT' | 'ORDER_REFUND' | 'ADMIN_ADJUST';
    note: string | null;
    refOrder: string | null;
    createdAt: string;
  }>;
  orders: Array<{
    orderNo: string;
    productTitle: string;
    skuName: string;
    quantity: number;
    payAmount: number;
    payMethod: string;
    status: string;
    createdAt: string;
    kind: 'LOCAL';
  }>;
  forgeOrders: Array<{
    orderNo: string;
    typeName: string;
    quantity: number;
    payAmount: number | null;
    totalAmount: number;
    paymentMethod: string;
    status: string;
    createdAt: string;
    kind: 'FORGE';
  }>;
};

export const api = {
  // ??
  publicSettings: () => http.get('/site-settings/public'),
  announcements: () => http.get('/announcements/active'),

  // ?? / ??
  categories: () => http.get('/categories'),
  products: (params?: { categoryId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    http.get('/products', { params }),
  product: (id: number) => http.get(`/products/${id}`),

  // ??
  createOrder: (body: any) => http.post('/orders', body),
  orderQuery: (orderNo: string, contact?: string) =>
    http.get(`/orders/query/${orderNo}`, contact ? { params: { contact } } : undefined),
  mockPay: (orderNo: string) => http.post(`/orders/${orderNo}/mock-pay`),
  myOrders: (params: any) => http.get('/orders/mine', { params }),
  myForgeOrders: (params: any) =>
    http.get<{ total: number; page: number; pageSize: number; items: any[] }>(
      '/forge-redeem/orders/mine',
      { params },
    ),

  // ??
  register: (body: {
    username: string;
    password: string;
    email?: string;
    nickname?: string;
    inviteCode?: string;
    captchaId: string;
    captchaCode: string;
  }) => http.post('/website-auth/register', body),
  login: (body: {
    username: string;
    password: string;
    captchaId: string;
    captchaCode: string;
  }) => http.post('/website-auth/login', body),
  // silent????????401 ??restore()/????????????????
  profile: () => http.get('/website-auth/profile', { silent: true } as any),

  // ??????
  captcha: () =>
    http.get<{ id: string; svg: string; expiresIn: number }>('/captcha'),

  // ??????????
  recharge: {
    create: (amount: number) =>
      http.post<{ orderNo: string; amount: number; expireAt: string }>('/recharge', { amount }),
    detail: (orderNo: string) =>
      http.get<{
        orderNo: string;
        amount: number;
        status: 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
        payMethod: string;
        paidAt: string | null;
        expireAt: string;
        createdAt: string;
      }>(`/recharge/${encodeURIComponent(orderNo)}`),
    listMine: (params?: { page?: number; pageSize?: number }) =>
      http.get<{
        total: number;
        page: number;
        pageSize: number;
        items: Array<{
          orderNo: string;
          amount: number;
          status: string;
          payMethod: string;
          paidAt: string | null;
          expireAt: string;
          createdAt: string;
        }>;
      }>('/recharge', { params }),
  },

  // ??
  balanceLogs: (params: any) => http.get('/users/my/balance-logs', { params }),
  points: {
    me: () => http.get('/points/me'),
    logs: (params?: { page?: number; pageSize?: number }) => http.get('/points/logs', { params }),
  },

  // ??
  feedback: (body: any) => http.post('/feedbacks/submit', body),

  // ?????????????????????????
  customerRefund: {
    apply: (email: string) =>
      http.post<{ status: string; message: string }>(
        '/customer-refund/apply',
        { email },
        { silent: true } as any,
      ),
    // 凭 token 直接退款（不校验白名单）：服务端先判会员类型
    //   free → DONE；付费档 → NEED_PAY（需先付手续费，Ultra ¥50 / 其它 ¥10）
    applyToken: (token: string) =>
      http.post<{
        status: 'DONE' | 'NEED_PAY';
        message: string;
        id?: number;
        payOrderNo?: string;
        feeAmount?: number;
        membershipType?: string;
      }>('/customer-refund/apply-token', { token }, { silent: true } as any),
    // 轮询 token 退款进度（按记录 id）
    tokenStatus: (id: number) =>
      http.get<{ found: boolean; status: string; payStatus?: string; message: string }>(
        '/customer-refund/token-status',
        { params: { id }, silent: true } as any,
      ),
    status: (email: string) =>
      http.get<{ found: boolean; status: string; message: string }>(
        '/customer-refund/status',
        { params: { email }, silent: true } as any,
      ),
  },

  // ?????????????????? Cursor ??????
  recycle: (email: string, invoiceNumber: string) =>
    http.post<{
      ok: boolean;
      email: string;
      invoiceNumber: string;
      to: string;
      message: string;
      response: unknown;
    }>('/recycle', { email, invoiceNumber }),

  // ??
  poolQuery: (orderNo: string, silent = false) =>
    http.get(`/pool/grants/${orderNo}`, silent ? ({ silent: true } as any) : undefined),
  poolClaim: (orderNo: string) => http.post(`/pool/grants/${orderNo}/claim-account`),
  poolBind: (orderNo: string, token: string) => http.post(`/pool/grants/${orderNo}/bind-token`, { token }),
  activate: (body: { token: string; captcha?: string }) => http.post('/pool/activate', body),

  // Admin
  admin: {
    dashboard: () => http.get('/admin/dashboard'),
    recent: () => http.get('/admin/orders/recent'),
    orders: (params: any) => http.get('/admin/orders', { params }),
    orderDetail: (orderNo: string) => http.get(`/admin/orders/${orderNo}`),
    orderMarkPaid: (orderNo: string) => http.post(`/admin/orders/${orderNo}/mark-paid`),
    orderRedeliver: (orderNo: string) => http.post(`/admin/orders/${orderNo}/redeliver`),
    orderManualDeliver: (orderNo: string, contents: string[]) =>
      http.post(`/admin/orders/${orderNo}/manual-deliver`, { contents }),
    orderRefund: (orderNo: string, reason?: string) =>
      http.post(`/admin/orders/${orderNo}/refund`, { reason }),
    orderCancel: (orderNo: string) => http.post(`/admin/orders/${orderNo}/cancel`),
    orderDelete: (orderNo: string) => http.delete(`/admin/orders/${orderNo}`),
    revenueTrend: (days = 14) => http.get(`/admin/trend/revenue`, { params: { days } }),
    stockAlerts: (threshold = 5) => http.get(`/admin/stock/alerts`, { params: { threshold } }),

    productsListAll: (params?: { status?: string; keyword?: string; categoryId?: number }) =>
      http.get('/products/admin/all', { params }),
    productsCreate: (body: any) => http.post('/products', body),
    productsUpdate: (id: number, body: any) => http.put(`/products/${id}`, body),
    productsRemove: (id: number) => http.delete(`/products/${id}`),
    productsSetStatus: (id: number, status: string) =>
      http.put(`/products/${id}/status`, { status }),

    catsCreate: (body: any) => http.post('/categories', body),
    catsUpdate: (id: number, body: any) => http.put(`/categories/${id}`, body),
    catsRemove: (id: number) => http.delete(`/categories/${id}`),

    keysList: (params: any) => http.get('/card-keys', { params }),
    keysBulk: (body: any) => http.post('/card-keys/bulk-import', body),
    keysBulkRemove: (ids: number[]) => http.post('/card-keys/bulk-remove', { ids }),
    keysPurge: (skuId: number, status: string) =>
      http.post('/card-keys/purge', { skuId, status }),
    keysOverview: () => http.get('/card-keys/overview'),
    keysRemove: (id: number) => http.delete(`/card-keys/${id}`),

    users: (params: any) => http.get('/users', { params }),
    userDetail: (id: number) => http.get<AdminUserDetail>(`/users/${id}/detail`),
    userAdjust: (id: number, body: any) => http.put(`/users/${id}/adjust-balance`, body),
    userAdjustPoints: (id: number, body: any) => http.post(`/points/admin/users/${id}/adjust`, body),
    pointLogs: (params: any) => http.get('/points/admin/logs', { params }),

    annsList: () => http.get('/announcements'),
    annsCreate: (body: any) => http.post('/announcements', body),
    annsUpdate: (id: number, body: any) => http.put(`/announcements/${id}`, body),
    annsRemove: (id: number) => http.delete(`/announcements/${id}`),

    poolAccounts: (params: any) => http.get('/pool/accounts', { params }),
    poolReveal: (id: number) => http.get<{ id: number; label: string; token: string }>(`/pool/accounts/${id}/reveal`),
    poolCreate: (body: any) => http.post('/pool/accounts', body),
    poolUpdate: (id: number, body: any) => http.put(`/pool/accounts/${id}`, body),
    poolRemove: (id: number) => http.delete(`/pool/accounts/${id}`),
    poolRefresh: () => http.post('/pool/accounts/refresh-all'),

    warehouseList: (params: any) => http.get('/warehouse', { params }),
    warehouseGet: (id: number) => http.get(`/warehouse/${id}`),
    warehouseCursorInfo: (id: number) =>
      http.get<{ ok: boolean; email?: string; membershipType?: string; usagePercent?: number | null; usageText?: string; error?: string }>(
        `/warehouse/${id}/cursor-info`,
        { silent: true } as any,
      ),
    warehouseAssign: (id: number, body: { productId: number; skuId: number }) =>
      http.post(`/warehouse/${id}/assign`, body),
    warehouseUnassign: (id: number) => http.post(`/warehouse/${id}/unassign`),
    warehouseRemove: (id: number) => http.delete(`/warehouse/${id}`),
    warehouseSetRefundTime: (
      id: number,
      body: { refundAt: string | null; refundNote?: string | null },
    ) => http.put(`/warehouse/${id}/refund-time`, body),
    warehouseNotifyRefund: (id: number) => http.post(`/warehouse/${id}/notify-refund`),
    warehouseRefundNow: (id: number) =>
      http.post<{ refundStatus: string; amount?: number; refundLog?: string[] }>(
        `/warehouse/${id}/refund`,
        undefined,
        { silent: true, timeout: REFUND_TIMEOUT } as any,
      ),
    warehouseRefundReset: (id: number) => http.post(`/warehouse/${id}/refund-reset`),
    warehouseBulkImport: (items: any[]) => http.post('/warehouse/bulk-import', { items }),
    warehouseManualAdd: (body: { content: string; remark?: string }) =>
      http.post<{ total: number; created: number; duplicated: number }>('/warehouse/manual-add', body),

    // ??????
    recycleList: (params: { status?: string; keyword?: string; page?: number; pageSize?: number }) =>
      http.get<{
        total: number;
        page: number;
        pageSize: number;
        items: Array<{
          id: number;
          email: string;
          invoiceNumber: string;
          orderNo: string | null;
          plan: string | null;
          status: 'PENDING' | 'SUCCESS' | 'UNKNOWN';
          mailMessageId: string | null;
          lastCheckedAt: string | null;
          createdAt: string;
        }>;
      }>('/recycle', { params }),
    recycleRefresh: (id: number) => http.post(`/recycle/${id}/refresh`),
    recycleRemove: (id: number) => http.delete(`/recycle/${id}`),

    // Aizhp Open ??
    aizhpPing: () => http.get('/aizhp-open/ping'),
    aizhpAccounts: (params?: { filter?: string; page?: number; pageSize?: number }) =>
      http.get('/aizhp-open/accounts', { params }),
    aizhpQuotas: () => http.get('/aizhp-open/quotas'),
    aizhpRefund: (body: { email: string; plan: string; refund_method?: string }) =>
      http.post('/aizhp-open/refund', body),
    aizhpRefunds: (params?: { page?: number; pageSize?: number }) =>
      http.get('/aizhp-open/refunds', { params }),
    aizhpRefundDetail: (id: number) => http.get(`/aizhp-open/refunds/${id}`),

    settings: () => http.get('/site-settings/all'),
    settingsSet: (body: any) => http.post('/site-settings', body),

    auditList: (params: any) => http.get('/admin/audit', { params }),
    auditActions: () => http.get<string[]>('/admin/audit/actions'),

    // IP ?????? / ?? ????????
    abuseList: () =>
      http.get<Array<{ ip: string; reason: string; createdAt: number; ttl: number }>>(
        '/admin/abuse/blocked',
      ),
    abuseBlock: (ip: string, seconds?: number, reason?: string) =>
      http.post<{ ok: boolean }>('/admin/abuse/block', { ip, seconds, reason }),
    abuseUnblock: (ip: string) =>
      http.delete<{ ok: boolean }>(`/admin/abuse/block/${encodeURIComponent(ip)}`),
    abuseProfile: (ip: string, days = 30) =>
      http.get<{
        ip: string;
        days: number;
        blocked: boolean;
        stats: {
          totalRequests: number;
          firstSeen: string | null;
          lastSeen: string | null;
          distinctActions: number;
          distinctUserAgents: number;
          linkedAccounts: number;
        };
        actions: Array<{ action: string; count: number }>;
        userAgents: Array<{ ua: string; count: number }>;
        timeline: Array<{ t: string; count: number }>;
        linkedUsers: Array<{
          id: number;
          username: string;
          email: string | null;
          createdAt: string;
          balance: string | number;
          role: string;
        }>;
        linkedOrders: { local: any[]; forge: any[] };
        recentLogs: Array<{
          id: number;
          action: string;
          target: string | null;
          actor: string | null;
          userAgent: string | null;
          detail: any;
          createdAt: string;
        }>;
      }>(`/admin/abuse/profile/${encodeURIComponent(ip)}`, { params: { days } }),

    alipayReload: () => http.post('/pay/alipay/reload'),
    alipayQuery: (orderNo: string) =>
      http.get<{ tradeStatus: string | null; tradeNo?: string; totalAmount?: number; buyerLogonId?: string }>(
        `/pay/alipay/query/${orderNo}`,
      ),
    alipayRefund: (orderNo: string, reason?: string) =>
      http.post<{ ok: boolean; amount: number; refundFee?: number }>(
        `/pay/alipay/refund/${orderNo}`,
        { reason },
      ),

    // ????
    // ?????cursor-jb ???
    cursorSubList: (params: { status?: string; keyword?: string; page?: number; pageSize?: number }) =>
      http.get('/admin/cursor-sub', { params }),
    cursorSubGet: (id: number) => http.get(`/admin/cursor-sub/${id}`),
    cursorSubCreate: (body: any) => http.post('/admin/cursor-sub', body),
    cursorSubUpdate: (id: number, body: any) => http.put(`/admin/cursor-sub/${id}`, body),
    cursorSubRemove: (id: number) => http.delete(`/admin/cursor-sub/${id}`),
    cursorSubBulkImport: (body: { text: string; separator?: string; subscriptionDays?: number }) =>
      http.post('/admin/cursor-sub/bulk-import', body),
    cursorSubExport: (id: number, separator = '----') =>
      http.get(`/admin/cursor-sub/${id}/export`, { params: { separator } }),
    cursorSubMarkPaid: (id: number) => http.post(`/admin/cursor-sub/${id}/mark-paid`),
    cursorSubSync: (id: number) => http.post(`/admin/cursor-sub/${id}/sync-subscription`),
    cursorSubSyncMany: (ids: number[]) =>
      http.post<{ total: number; ok: number; failed: any[] }>(
        '/admin/cursor-sub/sync-subscriptions',
        { ids },
        { silent: true } as any,
      ),
    cursorSubUsage: (id: number) => http.get(`/admin/cursor-sub/${id}/usage`, { silent: true } as any),
    cursorSubPush: (id: number) => http.post(`/admin/cursor-sub/${id}/push-to-warehouse`),
    cursorSubCheckoutLink: (id: number) =>
      http.post<{ id: number; email: string; url: string; at: string }>(
        `/admin/cursor-sub/${id}/checkout-link`,
        undefined,
        { silent: true } as any,
      ),
    cursorSubCheckoutLinks: (ids: number[]) =>
      http.post<{ total: number; ok: any[]; failed: any[] }>(
        '/admin/cursor-sub/checkout-links',
        { ids },
        { silent: true } as any,
      ),

    // 额度号池（按 Cursor 额度计价，不走商城）
    cursorQuotaStats: () => http.get('/admin/cursor-quota/stats'),
    cursorQuotaModelPricingSettings: () =>
      http.get<{
        premiumModels: string[];
        autoModels: string[];
        knownModels: string[];
      }>('/admin/cursor-quota/model-pricing-settings'),
    cursorQuotaUpdateModelPricingSettings: (body: {
      premiumModels: string[];
      autoModels: string[];
    }) => http.put('/admin/cursor-quota/model-pricing-settings', body),
    cursorQuotaList: (params: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      accountStatus?: string;
      sortBy?: string;
      sortOrder?: string;
    }) => http.get('/admin/cursor-quota', { params }),
    cursorQuotaGet: (id: number) => http.get(`/admin/cursor-quota/${id}`),
    cursorQuotaCreate: (body: any) => http.post('/admin/cursor-quota', body),
    cursorQuotaUpdate: (id: number, body: any) => http.patch(`/admin/cursor-quota/${id}`, body),
    cursorQuotaRemove: (id: number) => http.delete(`/admin/cursor-quota/${id}`),
    cursorQuotaBulkImport: (body: {
      text: string;
      pricePerUsd?: number;
      autoPricePerUsd?: number;
      purchasePrice?: number;
    }) => http.post('/admin/cursor-quota/bulk-import', body),
    cursorQuotaRefresh: (id: number) =>
      http.post(`/admin/cursor-quota/${id}/refresh`, undefined, { timeout: 60_000 }),
    cursorQuotaRefreshAll: () =>
      http.post('/admin/cursor-quota/refresh-all', undefined, { timeout: 10 * 60 * 1000 }),
    cursorQuotaReport: (id: number) =>
      http.get(`/admin/cursor-quota/${id}/report`, { timeout: 60_000, silent: true } as any),
    cursorQuotaSnapshots: (id: number) => http.get(`/admin/cursor-quota/${id}/snapshots`),

    // ??????? token?
    // ???????
    refundWlList: (params: { status?: string; keyword?: string; page?: number; pageSize?: number }) =>
      http.get('/admin/customer-refund', { params }),
    refundWlAdd: (body: { email: string; cursorToken: string; note?: string }) =>
      http.post('/admin/customer-refund', body),
    refundWlUpdate: (id: number, body: any) => http.put(`/admin/customer-refund/${id}`, body),
    refundWlRemove: (id: number) => http.delete(`/admin/customer-refund/${id}`),
    refundWlBulkImport: (body: { text: string; separator?: string }) =>
      http.post<{ totalLines: number; created: number; skipped: any[]; batchTag: string }>(
        '/admin/customer-refund/bulk-import',
        body,
      ),
    refundWlRefundNow: (id: number) =>
      http.post(`/admin/customer-refund/${id}/refund`, undefined, {
        silent: true,
        timeout: REFUND_TIMEOUT,
      } as any),
    refundWlReset: (id: number) => http.post(`/admin/customer-refund/${id}/refund-reset`),

    // 前台「凭 token 直接退款」的记录
    tokenRefundList: (params: { status?: string; keyword?: string; page?: number; pageSize?: number }) =>
      http.get('/admin/customer-refund/token-logs', { params }),
    tokenRefundRemove: (id: number) => http.delete(`/admin/customer-refund/token-logs/${id}`),
    tokenRefundRecheck: (id: number) =>
      http.post<{
        ok: boolean;
        status: string;
        membershipType?: string;
        message: string;
      }>(`/admin/customer-refund/token-logs/${id}/recheck`, undefined, {
        silent: true,
      } as any),
    tokenRefundRetry: (id: number) =>
      http.post<{ ok: boolean; status: string; message: string }>(
        `/admin/customer-refund/token-logs/${id}/retry`,
        undefined,
        { silent: true } as any,
      ),

    cursorRefundStatus: () =>
      http.post<{ ready: boolean; teamId: number; hasOwner: boolean }>('/admin/cursor-refund/status'),
    cursorRefundManual: (tokens: string[]) =>
      http.post<{
        total: number;
        ok: number;
        failed: number;
        results: Array<{
          email: string;
          ok: boolean;
          amount: number;
          prevMembership: string;
          finalMembership: string;
          error?: string;
        }>;
      }>('/admin/cursor-refund/manual', { tokens }, { silent: true, timeout: REFUND_TIMEOUT } as any),

    redeemGenerate: (body: any) => http.post('/admin/redeem-codes/generate', body),
    redeemList: (params: any) => http.get('/admin/redeem-codes', { params }),
    redeemOverview: () => http.get<{ ACTIVE: number; DISABLED: number; EXHAUSTED: number; EXPIRED: number; total: number }>('/admin/redeem-codes/overview'),
    redeemBatches: () => http.get<Array<{ batchTag: string; count: number; createdAt: string }>>('/admin/redeem-codes/batches'),
    redeemGetBatch: (tag: string) => http.get<{ batchTag: string; count: number; items: any[] }>(`/admin/redeem-codes/batch/${tag}`),
    redeemSetStatus: (id: number, status: 'ACTIVE' | 'DISABLED') =>
      http.put(`/admin/redeem-codes/${id}/status`, { status }),
    redeemBatchStatus: (ids: number[], status: 'ACTIVE' | 'DISABLED') =>
      http.post('/admin/redeem-codes/batch-status', { ids, status }),
    redeemRemove: (id: number) => http.delete(`/admin/redeem-codes/${id}`),
    redeemBatchRemove: (ids: number[]) => http.post('/admin/redeem-codes/batch-remove', { ids }),
  },

  redeem: {
    info: (code: string) =>
      http.get(`/redeem/${encodeURIComponent(code)}`, { silent: true } as any),
    use: (body: { code: string; contact?: string }) => http.post('/redeem', body),
  },

  pay: {
    alipayEnabled: () => http.get<{ enabled: boolean }>('/pay/alipay/enabled'),
    alipayCreate: (orderNo: string, channel: 'PC' | 'WAP' = 'PC') =>
      http.get<{ orderNo: string; payUrl: string }>(`/pay/alipay/create/${orderNo}`, {
        params: { channel },
      }),
  },

  forge: {
    // ?? ? ??
    listProducts: () =>
      http.get<Array<{
        typeKey: string;
        categoryKey: string;
        categoryName: string;
        typeName: string;
        displayPrice: number;
        agentPrice: number;
        stock: number;
        warrantyHours: number | null;
        emailCodeEnabled: boolean;
        pointsAwardEnabled: boolean;
        pointsPayEnabled: boolean;
        pointsAwardRate: number | null;
        subtitle?: string | null;
        coverImage?: string | null;
        description?: string | null;
        highlights?: string[] | null;
        notice?: string | null;
      }>>('/forge-redeem/products'),
    getProduct: (typeKey: string) =>
      http.get<any>(`/forge-redeem/products/${encodeURIComponent(typeKey)}`),

    // ?? ? ????
    check: (code: string) =>
      http.post<{
        code: string;
        status: 'ACTIVE' | 'DISABLED' | 'EXHAUSTED' | 'EXPIRED';
        totalAmount: number;
        usedAmount: number;
        remaining: number;
        expireAt: string | null;
        note?: string;
        orders: Array<{
          orderNo: string;
          typeName: string;
          typeKey: string;
          quantity: number;
          totalAmount: number;
          status: 'PENDING' | 'PAID' | 'DELIVERED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
          createdAt: string;
          deliveredAt?: string;
        }>;
        products: any[];
      }>('/forge-redeem/check', { code }, { silent: true } as any),

    // ?? ? ??????????
    order: (body: { code: string; typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/order', body, { silent: true } as any),

    // ?? ? ??????????
    alipayOrder: (body: { typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/alipay-order', body, { silent: true } as any),

    // ?? ? ????????
    balanceOrder: (body: { typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/balance-order', body, { silent: true } as any),

    // ?? ? ????????
    pointsOrder: (body: { typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/points-order', body, { silent: true } as any),

    // ?? ? ?????? contact ????
    orderDetail: (orderNo: string, contact?: string) =>
      http.get<any>(
        `/forge-redeem/order/${encodeURIComponent(orderNo)}`,
        contact ? { params: { contact } } : undefined,
      ),

    // ?? ?????? Key ????????????????????????
    quota: {
      // ?? ? ??????/ ??
      listPackages: () =>
        http.get<Array<{
          packageKey: string;
          name: string;
          quotaUsd: number;
          lineKey: string;
          displayPrice: number;
          retailPrice: number;
          pointsAwardEnabled: boolean;
          pointsPayEnabled: boolean;
          pointsAwardRate: number | null;
          subtitle?: string | null;
          coverImage?: string | null;
          description?: string | null;
          highlights?: string[] | null;
          notice?: string | null;
        }>>('/forge-quota/packages'),
      getPackage: (packageKey: string) =>
        http.get<any>(`/forge-quota/packages/${encodeURIComponent(packageKey)}`),

      // ?? ? ????????????
      order: (body: { code: string; packageKey: string; quantity: number; contact?: string }) =>
        http.post<any>('/forge-quota/order', body, { silent: true } as any),
      // ?? ? ??????????
      alipayOrder: (body: { packageKey: string; quantity: number; contact?: string }) =>
        http.post<any>('/forge-quota/alipay-order', body, { silent: true } as any),
      // ?? ? ????????
      balanceOrder: (body: { packageKey: string; quantity: number; contact?: string }) =>
        http.post<any>('/forge-quota/balance-order', body, { silent: true } as any),
      // ?? ? ????????
      pointsOrder: (body: { packageKey: string; quantity: number; contact?: string }) =>
        http.post<any>('/forge-quota/points-order', body, { silent: true } as any),

      // ?? ? ?????? contact ????
      orderDetail: (orderNo: string, contact?: string) =>
        http.get<any>(
          `/forge-quota/order/${encodeURIComponent(orderNo)}`,
          contact ? { params: { contact } } : undefined,
        ),
      // ?? ? ???????????????
      refreshCodes: (orderNo: string, contact?: string) =>
        http.post<any>(
          `/forge-quota/order/${encodeURIComponent(orderNo)}/refresh-codes`,
          contact ? { contact } : {},
          { silent: true } as any,
        ),
      // ?? ? ????????
      myOrders: (params: any) =>
        http.get<{ total: number; page: number; pageSize: number; items: any[] }>(
          '/forge-quota/orders/mine',
          { params },
        ),

      // Admin
      admin: {
        syncPackages: () =>
          http.post<{ upserted: number; syncedAt: string }>('/admin/forge/quota/packages/sync'),
        listPackages: () =>
          http.get<Array<{
            packageKey: string;
            name: string;
            quotaUsd: number;
            lineKey: string;
            agentPrice: number;
            retailPrice: number;
            displayPrice: number;
            enabled: boolean;
            sort: number;
            pointsAwardEnabled: boolean;
            pointsPayEnabled: boolean;
            pointsAwardRate: number | null;
            customName?: string | null;
            subtitle?: string | null;
            coverImage?: string | null;
            description?: string | null;
            highlights?: string | null;
            notice?: string | null;
            lastSyncAt?: string | null;
          }>>('/admin/forge/quota/packages'),
        updatePackage: (
          packageKey: string,
          body: {
            displayPrice?: number;
            enabled?: boolean;
            sort?: number;
            pointsAwardEnabled?: boolean;
            pointsPayEnabled?: boolean;
            pointsAwardRate?: number | null;
            customName?: string | null;
            subtitle?: string | null;
            coverImage?: string | null;
            description?: string | null;
            highlights?: string | null;
            notice?: string | null;
          },
        ) => http.put(`/admin/forge/quota/packages/${encodeURIComponent(packageKey)}`, body),

        listOrders: (params: any) => http.get('/admin/forge/quota/orders', { params }),
        orderDetail: (orderNo: string) =>
          http.get(`/admin/forge/quota/orders/${encodeURIComponent(orderNo)}`),
        retryFulfill: (orderNo: string) =>
          http.post(`/admin/forge/quota/orders/${encodeURIComponent(orderNo)}/retry`),
        refreshCodes: (orderNo: string) =>
          http.post(`/admin/forge/quota/orders/${encodeURIComponent(orderNo)}/refresh-codes`),
        deleteOrder: (orderNo: string) =>
          http.delete(`/admin/forge/quota/orders/${encodeURIComponent(orderNo)}`),

        // ????????/ ???????
        queryCode: (code: string) =>
          http.get<{
            code: string;
            status: 'unused' | 'used' | 'voided';
            status_text?: string;
            package_key: string;
            quota_usd: number;
            line_key: string;
            order_no: string;
            batch_no: string;
            redeem_url: string;
            used_at: string | null;
            voided_at: string | null;
            void_reason: string | null;
            created_at: string;
          }>(`/admin/forge/quota/codes/${encodeURIComponent(code)}`, { silent: true } as any),
        voidCodes: (codes: string[], reason?: string) =>
          http.post<{
            voided: string[];
            voidedCount: number;
            skipped: Array<{ code: string; reason: string }>;
            refunded: Array<{ order_no: string; codes_count: number; unit_price: number; amount: number }>;
            refundSkipped: any[];
            refundTotal: number;
            balanceAfter: number | null;
            message: string;
          }>('/admin/forge/quota/codes/void', { codes, reason }),
      },
    },

    // Admin
    admin: {
      syncProducts: () => http.post<{ upserted: number; syncedAt: string }>('/admin/forge/products/sync'),
      listProducts: () =>
        http.get<Array<{
          typeKey: string;
          categoryKey: string;
          categoryName: string;
          typeName: string;
          price: number;
          agentPrice: number;
          displayPrice: number;
          stock: number;
          warrantyHours: number | null;
          emailCodeEnabled: boolean;
          enabled: boolean;
          pointsAwardEnabled: boolean;
          pointsPayEnabled: boolean;
          pointsAwardRate: number | null;
          sort: number;
          customName?: string | null;
          customCategoryName?: string | null;
          subtitle?: string | null;
          coverImage?: string | null;
          description?: string | null;
          highlights?: string | null;
          notice?: string | null;
          lastSyncAt?: string | null;
        }>>('/admin/forge/products'),
      updateProduct: (
        typeKey: string,
        body: {
          displayPrice?: number;
          enabled?: boolean;
          sort?: number;
          pointsAwardEnabled?: boolean;
          pointsPayEnabled?: boolean;
          pointsAwardRate?: number | null;
          customName?: string | null;
          customCategoryName?: string | null;
          subtitle?: string | null;
          coverImage?: string | null;
          description?: string | null;
          highlights?: string | null;
          notice?: string | null;
        },
      ) => http.put(`/admin/forge/products/${encodeURIComponent(typeKey)}`, body),

      generateCodes: (body: any) => http.post('/admin/forge/redeem-codes/generate', body),
      listCodes: (params: any) => http.get('/admin/forge/redeem-codes', { params }),
      batches: () => http.get('/admin/forge/redeem-codes/batches'),
      getBatch: (tag: string) =>
        http.get(`/admin/forge/redeem-codes/batch/${encodeURIComponent(tag)}`),
      toggleStatus: (id: number, status: 'ACTIVE' | 'DISABLED') =>
        http.put(`/admin/forge/redeem-codes/${id}/status`, { status }),
      removeCode: (id: number) => http.delete(`/admin/forge/redeem-codes/${id}`),

      listOrders: (params: any) => http.get('/admin/forge/orders', { params }),
      orderDetail: (orderNo: string) =>
        http.get(`/admin/forge/orders/${encodeURIComponent(orderNo)}`),
      retryFulfill: (orderNo: string) =>
        http.post(`/admin/forge/orders/${encodeURIComponent(orderNo)}/retry`),
      deleteOrder: (orderNo: string) =>
        http.delete(`/admin/forge/orders/${encodeURIComponent(orderNo)}`),
    },
  },

  vip: {
    /** ??????????*/
    configs: () =>
      http.get<Array<{
        tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
        name: string;
        threshold: number;
        defaultDiscount: number;
        color: string | null;
        icon: string | null;
        benefits: string[];
        sort: number;
      }>>('/vip/configs'),
    /** ????????3 ?????? */
    productDiscounts: (productSource: 'LOCAL' | 'FORGE' | 'FORGE_QUOTA', productKey: string) =>
      http.get<Array<{
        tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
        name: string;
        icon: string | null;
        color: string | null;
        discount: number;
        isOverride: boolean;
      }>>('/vip/product-discounts', { params: { productSource, productKey } }),
    /** ??/????????????????*/
    preview: (body: { productSource: 'LOCAL' | 'FORGE' | 'FORGE_QUOTA'; productKey: string; originalAmount: number }) =>
      http.post<{
        tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
        discount: number;
        originalAmount: number;
        discountAmount: number;
        payAmount: number;
      }>('/vip/preview', body),
    /** ??????VIP ?? */
    me: () =>
      http.get<{
        tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
        tierName: string;
        tierColor: string | null;
        tierIcon: string | null;
        totalRecharged: number;
        benefits: string[];
        defaultDiscount: number;
        customDiscount: number | null;
        upgradedAt: string | null;
        next: null | {
          tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
          name: string;
          threshold: number;
          remain: number;
          progress: number;
        };
        // silent?UI ????token ??????????????
      }>('/vip/me', { silent: true } as any),
    /** ?????????? */
    adminConfigs: () => http.get('/vip/admin/configs'),
    /** ?????????? */
    adminUpdateConfig: (
      tier: 'GOLD' | 'DIAMOND' | 'SUPREME',
      body: {
        name: string;
        threshold: number;
        defaultDiscount: number;
        color?: string;
        icon?: string;
        benefits?: string[];
      },
    ) => http.put(`/vip/admin/configs/${tier}`, body),
    /** ???????????*/
    adminDiscounts: (productSource?: 'LOCAL' | 'FORGE' | 'FORGE_QUOTA') =>
      http.get<Array<{
        id: number;
        productSource: 'LOCAL' | 'FORGE' | 'FORGE_QUOTA';
        productKey: string;
        tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
        discount: number;
        updatedAt: string;
      }>>('/vip/admin/discounts', { params: productSource ? { productSource } : {} }),
    /** ??????/?????? */
    adminUpsertDiscount: (body: {
      productSource: 'LOCAL' | 'FORGE' | 'FORGE_QUOTA';
      productKey: string;
      tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
      discount: number;
    }) => http.post<{ id: number }>('/vip/admin/discounts', body),
    /** ?????????? */
    adminRemoveDiscount: (id: number) => http.delete(`/vip/admin/discounts/${id}`),
    /** ?????? VIP ?? */
    adminUsers: (params: { page?: number; pageSize?: number; keyword?: string; tier?: string }) =>
      http.get<{
        total: number;
        page: number;
        pageSize: number;
        items: Array<{
          id: number;
          username: string;
          email: string | null;
          nickname: string | null;
          vipTier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
          totalRecharged: number;
          balance: number;
          customDiscount: number | null;
          vipUpgradedAt: string | null;
          createdAt: string;
        }>;
      }>('/vip/admin/users', { params }),
    /** ???????? */
    adminManualSet: (
      id: number,
      body: { tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME'; note?: string },
    ) => http.post<{ tier: string; changed: boolean }>(`/vip/admin/users/${id}/set`, body),
    /** ??????/???????????discount=null ????*/
    adminSetUserDiscount: (
      id: number,
      body: { discount: number | null; note?: string },
    ) => http.post<{ customDiscount: number | null }>(`/vip/admin/users/${id}/discount`, body),
  },

  emailCode: {
    enabled: () => http.get<{ enabled: boolean }>('/email-code/enabled'),
    fetch: (body: {
      email: string;
      time_range?: number;
      clear_cache?: boolean;
      mark_read?: boolean;
      mail_id?: string;
    }) =>
      http.post<{
        ok?: boolean;
        code: string;
        found?: boolean;
        verification_code?: string | null;
        status?: string;
        message?: string;
        hint?: string;
        terminal?: boolean;
        mail_id?: string;
        mail_time?: number;
        from_cache?: boolean;
        email?: string;
        channel?: string;
        type_key?: string;
        type_name?: string;
        expire_at?: string;
        order_no?: string;
        request_id?: string;
      }>('/email-code/fetch', body, { silent: true } as any),
  },

  aizhpCode: {
    enabled: () => http.get<{ enabled: boolean }>('/aizhp-open/enabled'),
    fetch: (body: { email: string; since?: number }) =>
      http.post<{
        ok: boolean;
        found: boolean;
        verification_code?: string;
        message?: string;
        terminal?: boolean;
      }>('/aizhp-open/code', body, { silent: true } as any),
    userRefund: (body: { email: string }) =>
      http.post<{
        success: boolean;
        refund_id?: number;
        message?: string;
        plan?: string;
        remaining_quota?: string;
      }>('/aizhp-open/user-refund', body),
  },
};

export default api;
