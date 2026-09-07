import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { AuditActions } from '../audit/audit.constants';
import { CursorSellService } from './cursor-sell.service';
import { CursorSellCatalogService } from './cursor-sell-catalog.service';
import { CursorSellFulfilService, PushDestination } from './cursor-sell-fulfil.service';
import { CursorSellListingService } from './cursor-sell-listing.service';

class ListingRulesDto {
  @IsOptional() @IsBoolean() autoList?: boolean;
  @IsOptional() @IsInt() categoryId?: number | null;
  @IsOptional() @IsNumber() @Min(0) markupYuan?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) markupPercent?: number;
  @IsOptional() @IsBoolean() followOffShelf?: boolean;
  @IsOptional() @IsNumber() @Min(0) minMarginYuan?: number;
}

class ListOneDto {
  @IsOptional() @IsInt() categoryId?: number;
  @IsOptional() @IsNumber() @Min(0) markupYuan?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) markupPercent?: number;
}

class ListBatchDto extends ListOneDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请选择要上架的商品' })
  @ArrayMaxSize(200)
  @IsString({ each: true })
  codes!: string[];
}

class WalletRedeemDto {
  @IsString()
  @IsNotEmpty({ message: '请填写充值卡码' })
  @MaxLength(128)
  code!: string;
}

class ManualPurchaseDto {
  @IsString()
  @IsNotEmpty({ message: '请选择渠道商品' })
  code!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  qty?: number;

  @IsOptional()
  @IsBoolean()
  extractSplit?: boolean;

  @IsOptional()
  @IsIn(['NONE', 'CARD_POOL', 'WAREHOUSE'])
  destination?: PushDestination;

  @IsOptional()
  @IsInt()
  skuId?: number;
}

class PushDto {
  @IsIn(['CARD_POOL', 'WAREHOUSE'])
  destination!: Exclude<PushDestination, 'NONE'>;

  @IsOptional()
  @IsInt()
  skuId?: number;
}

class LoginApproveDto {
  @IsString()
  @IsNotEmpty({ message: '请粘贴登录链接' })
  @MaxLength(4000)
  loginUrl!: string;
}

@ApiTags('admin-cursor-sell')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/cursor-sell')
export class CursorSellAdminController {
  constructor(
    private api: CursorSellService,
    private catalog: CursorSellCatalogService,
    private fulfil: CursorSellFulfilService,
    private listing: CursorSellListingService,
    private audit: AuditService,
  ) {}

  /** 概览：渠道状态 + 钱包余额 + 采购统计 */
  @Get('overview')
  async overview() {
    const enabled = await this.api.isEnabled();
    const hasApiKey = enabled && (await this.api.hasApiKey());
    let balanceCents: number | null = null;
    let walletError: string | null = null;
    if (hasApiKey) {
      try {
        balanceCents = (await this.api.getWallet()).balanceCents;
      } catch (e) {
        walletError = (e as Error).message;
      }
    }
    const stats = await this.fulfil.stats();
    const cfg = await this.api.loadConfig();
    return {
      enabled,
      hasApiKey,
      balanceCents,
      balance: balanceCents == null ? null : balanceCents / 100,
      walletError,
      lowBalanceCents: cfg?.lowBalanceCents ?? 0,
      ...stats,
    };
  }

  /** 兑换充值卡到售号钱包 */
  @Post('wallet/redeem')
  async walletRedeem(@Body() body: WalletRedeemDto, @Req() req: Request) {
    const code = body.code.trim();
    try {
      const r = await this.api.redeemWalletCard(code);
      void this.audit.fromReq(req, AuditActions.CURSOR_SELL_WALLET_REDEEM, {
        target: code,
        detail: { ok: true, amountCents: r.amountCents, balanceCents: r.balanceCents },
      });
      return { ...r, amount: r.amountCents / 100, balance: r.balanceCents / 100 };
    } catch (e) {
      void this.audit.fromReq(req, AuditActions.CURSOR_SELL_WALLET_REDEEM, {
        target: code,
        detail: { ok: false, error: (e as Error).message },
      });
      throw e;
    }
  }

  // ====== 商品缓存 ======

  /** 缓存列表 + 每个渠道商品对应的本站规格绑定（是否已上架 / 跟价 / 售价） */
  @Get('products')
  async products(@Query('activeOnly') activeOnly?: string) {
    const list = await this.catalog.list({ activeOnly: activeOnly === '1' || activeOnly === 'true' });
    const bindings = await this.listing.findLocalBindings(list.map((p) => p.code));
    return list.map((p) => ({ ...p, local: bindings.get(p.code) ?? [] }));
  }

  @Post('products/sync')
  async syncProducts(@Req() req: Request) {
    const r = await this.catalog.sync();
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_PRODUCT_SYNC, { detail: r });
    return r;
  }

  // ====== 自动上架 / 跟价规则 ======

  @Get('listing-rules')
  listingRules() {
    return this.listing.loadRules();
  }

  @Put('listing-rules')
  async saveListingRules(@Body() body: ListingRulesDto, @Req() req: Request) {
    const r = await this.listing.saveRules(body);
    this.api.invalidate();
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_LISTING_RULES, { detail: r });
    return r;
  }

  /** 把单个渠道商品上架为本站商品（一个跟价规格） */
  @Post('products/:code/list')
  async listOne(@Param('code') code: string, @Body() body: ListOneDto, @Req() req: Request) {
    const r = await this.listing.listProduct(code, body);
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_AUTO_LIST, {
      target: `product:${r.productId}`,
      detail: { code, created: r.created, price: r.price, by: 'admin' },
    });
    return r;
  }

  @Post('products/list-batch')
  async listBatch(@Body() body: ListBatchDto, @Req() req: Request) {
    const { codes, ...opts } = body;
    const r = await this.listing.listBatch(codes, opts);
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_AUTO_LIST, {
      detail: { total: r.total, created: r.created, existed: r.existed, failed: r.failed, by: 'admin' },
    });
    return r;
  }

  // ====== 采购单 ======

  @Get('purchases')
  purchases(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.fulfil.listPurchases({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      status: status || undefined,
      source: source || undefined,
      keyword: keyword?.trim() || undefined,
    });
  }

  @Get('purchases/:id')
  purchase(@Param('id') id: string) {
    return this.fulfil.getPurchase(Number(id));
  }

  /** 手动采购（可选直接入卡密池 / 仓库） */
  @Post('purchases/manual')
  async manualPurchase(@Body() body: ManualPurchaseDto, @Req() req: Request) {
    const user = (req as any).user as { sub?: number } | undefined;
    const r = await this.fulfil.manualPurchase({
      code: body.code,
      qty: body.qty ?? 1,
      extractSplit: body.extractSplit,
      destination: body.destination,
      skuId: body.skuId ?? null,
      operatorId: user?.sub ?? null,
    });
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_MANUAL_PURCHASE, {
      target: `purchase:${r.id}`,
      detail: { code: body.code, qty: body.qty ?? 1, status: r.status, destination: body.destination ?? 'NONE' },
    });
    return r;
  }

  @Post('purchases/:id/retry')
  async retry(@Param('id') id: string, @Req() req: Request) {
    const r = await this.fulfil.retryPurchase(Number(id));
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_PURCHASE_RETRY, {
      target: `purchase:${id}`,
      detail: { status: r.status },
    });
    return r;
  }

  /** 把采购单里未入库的成交推到卡密池 / 仓库 */
  @Post('purchases/:id/push')
  async pushPurchase(@Param('id') id: string, @Body() body: PushDto, @Req() req: Request) {
    const r = await this.fulfil.pushPurchase(Number(id), body.destination, body.skuId ?? null);
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_PUSH_STOCK, {
      target: `purchase:${id}`,
      detail: { destination: body.destination, skuId: body.skuId, pushed: r.pushed },
    });
    return r;
  }

  // ====== 成交明细 ======

  @Get('sales/:id')
  sale(@Param('id') id: string) {
    return this.fulfil.getSale(Number(id));
  }

  /** 重取凭据（GET /orders/:saleId） */
  @Post('sales/:id/refresh')
  refreshSale(@Param('id') id: string) {
    return this.fulfil.refreshSaleById(Number(id));
  }

  @Post('sales/:id/push')
  async pushSale(@Param('id') id: string, @Body() body: PushDto, @Req() req: Request) {
    const r = await this.fulfil.pushSale(Number(id), body.destination, body.skuId ?? null);
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_PUSH_STOCK, {
      target: `sale:${id}`,
      detail: { destination: body.destination, skuId: body.skuId },
    });
    return r;
  }

  @Get('sales/:id/usage')
  usage(@Param('id') id: string) {
    return this.fulfil.usage(Number(id));
  }

  @Get('sales/:id/login-tutorial')
  loginTutorial(@Param('id') id: string) {
    return this.fulfil.loginTutorial(Number(id));
  }

  /** 后台代用户确认授权登录 */
  @Post('sales/:id/login-approve')
  async loginApprove(@Param('id') id: string, @Body() body: LoginApproveDto, @Req() req: Request) {
    const r = await this.fulfil.loginApprove(Number(id), body.loginUrl);
    void this.audit.fromReq(req, AuditActions.CURSOR_SELL_LOGIN_APPROVE, {
      target: `sale:${id}`,
      detail: { approved: r.approved, by: 'admin' },
    });
    return r;
  }

  // ====== 上游直查 ======

  /** 上游订单摘要（对账用，不含 token / 卡密明文） */
  @Get('upstream/orders')
  upstreamOrders() {
    return this.api.listOrders();
  }

  /** 我的提取卡密（XB- 完整明文，仅管理员） */
  @Get('upstream/extract-cards')
  extractCards(@Query('paymentOrderNo') paymentOrderNo?: string) {
    return this.api.listExtractCards(paymentOrderNo?.trim() || undefined);
  }
}
