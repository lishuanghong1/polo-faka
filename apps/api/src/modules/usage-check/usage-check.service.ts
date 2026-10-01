import { Injectable } from '@nestjs/common';
import { CursorUsageService, QuotaReport } from '../cursor-quota/cursor-usage.service';

/** Public, stateless lookup: never reads or updates a local account. */
@Injectable()
export class UsageCheckService {
  constructor(private readonly usage: CursorUsageService) {}

  query(token: string): Promise<QuotaReport> {
    return this.usage.queryReport(token);
  }
}
