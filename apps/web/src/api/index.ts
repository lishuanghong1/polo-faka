import http from './http';

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
    totalRecharged: string;
    vipTier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
    vipUpgradedAt: string | null;
    createdAt: string;
    lastLogin: string | null;
  };
  wallet: {
    balance: number;
    totalRecharged: number;
    vipTier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
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
  // 站点
  publicSettings: () => http.get('/site-settings/public'),
  announcements: () => http.get('/announcements/active'),

  // 分类 / 商品
  categories: () => http.get('/categories'),
  products: (params?: { categoryId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    http.get('/products', { params }),
  product: (id: number) => http.get(`/products/${id}`),

  // 订单
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

  // 认证
  register: (body: {
    username: string;
    password: string;
    email?: string;
    nickname?: string;
    captchaId: string;
    captchaCode: string;
  }) => http.post('/website-auth/register', body),
  login: (body: {
    username: string;
    password: string;
    captchaId: string;
    captchaCode: string;
  }) => http.post('/website-auth/login', body),
  // silent：后台鉴权检查，401 由 restore()/路由守卫兜底处理，不直接弹错误
  profile: () => http.get('/website-auth/profile', { silent: true } as any),

  // 图形验证码
  captcha: () =>
    http.get<{ id: string; svg: string; expiresIn: number }>('/captcha'),

  // 账户充值（需登录）
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

  // 用户
  balanceLogs: (params: any) => http.get('/users/my/balance-logs', { params }),

  // 反馈
  feedback: (body: any) => http.post('/feedbacks/submit', body),

  // 池
  poolQuery: (orderNo: string) => http.get(`/pool/grants/${orderNo}`),
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

    settings: () => http.get('/site-settings/all'),
    settingsSet: (body: any) => http.post('/site-settings', body),

    auditList: (params: any) => http.get('/admin/audit', { params }),
    auditActions: () => http.get<string[]>('/admin/audit/actions'),

    // IP 黑名单（自动 / 手动 拉黑可疑来源）
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

    // 兑换码
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
    info: (code: string) => http.get(`/redeem/${encodeURIComponent(code)}`),
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
    // 公开 · 商品
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
        subtitle?: string | null;
        coverImage?: string | null;
        description?: string | null;
        highlights?: string[] | null;
        notice?: string | null;
      }>>('/forge-redeem/products'),
    getProduct: (typeKey: string) =>
      http.get<any>(`/forge-redeem/products/${encodeURIComponent(typeKey)}`),

    // 公开 · 兑换码
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

    // 公开 · 下单（兑换码路径）
    order: (body: { code: string; typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/order', body, { silent: true } as any),

    // 公开 · 下单（支付宝路径）
    alipayOrder: (body: { typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/alipay-order', body, { silent: true } as any),

    // 登录 · 下单（余额路径）
    balanceOrder: (body: { typeKey: string; quantity: number; contact?: string }) =>
      http.post<any>('/forge-redeem/balance-order', body, { silent: true } as any),

    // 公开 · 订单详情（带 contact 校验）
    orderDetail: (orderNo: string, contact?: string) =>
      http.get<any>(
        `/forge-redeem/order/${encodeURIComponent(orderNo)}`,
        contact ? { params: { contact } } : undefined,
      ),

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
    /** 公开：所有等级配置 */
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
    /** 公开：某商品的 3 档会员价对照 */
    productDiscounts: (productSource: 'LOCAL' | 'FORGE', productKey: string) =>
      http.get<Array<{
        tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
        name: string;
        icon: string | null;
        color: string | null;
        discount: number;
        isOverride: boolean;
      }>>('/vip/product-discounts', { params: { productSource, productKey } }),
    /** 公开/登录：金额预览（登录则带折扣） */
    preview: (body: { productSource: 'LOCAL' | 'FORGE'; productKey: string; originalAmount: number }) =>
      http.post<{
        tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
        discount: number;
        originalAmount: number;
        discountAmount: number;
        payAmount: number;
      }>('/vip/preview', body),
    /** 登录：我的 VIP 信息 */
    me: () =>
      http.get<{
        tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME';
        tierName: string;
        tierColor: string | null;
        tierIcon: string | null;
        totalRecharged: number;
        benefits: string[];
        defaultDiscount: number;
        upgradedAt: string | null;
        next: null | {
          tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
          name: string;
          threshold: number;
          remain: number;
          progress: number;
        };
        // silent：UI 增强用，token 过期时静默失败，不打扰浏览
      }>('/vip/me', { silent: true } as any),
    /** 管理员：等级配置列表 */
    adminConfigs: () => http.get('/vip/admin/configs'),
    /** 管理员：修改等级配置 */
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
    /** 管理员：所有商品折扣 */
    adminDiscounts: (productSource?: 'LOCAL' | 'FORGE') =>
      http.get<Array<{
        id: number;
        productSource: 'LOCAL' | 'FORGE';
        productKey: string;
        tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
        discount: number;
        updatedAt: string;
      }>>('/vip/admin/discounts', { params: productSource ? { productSource } : {} }),
    /** 管理员：新增/更新商品折扣 */
    adminUpsertDiscount: (body: {
      productSource: 'LOCAL' | 'FORGE';
      productKey: string;
      tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
      discount: number;
    }) => http.post<{ id: number }>('/vip/admin/discounts', body),
    /** 管理员：删除商品折扣 */
    adminRemoveDiscount: (id: number) => http.delete(`/vip/admin/discounts/${id}`),
    /** 管理员：用户 VIP 列表 */
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
          vipUpgradedAt: string | null;
          createdAt: string;
        }>;
      }>('/vip/admin/users', { params }),
    /** 管理员：手动调级 */
    adminManualSet: (
      id: number,
      body: { tier: 'NONE' | 'GOLD' | 'DIAMOND' | 'SUPREME'; note?: string },
    ) => http.post<{ tier: string; changed: boolean }>(`/vip/admin/users/${id}/set`, body),
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
};

export default api;
