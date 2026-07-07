import { Module } from '@nestjs/common';
import {
  CustomerRefundAdminController,
  CustomerRefundPublicController,
} from './customer-refund.controller';
import { CustomerRefundService } from './customer-refund.service';
import { CursorRefundModule } from '../cursor-refund/cursor-refund.module';

@Module({
  imports: [CursorRefundModule],
  controllers: [CustomerRefundPublicController, CustomerRefundAdminController],
  providers: [CustomerRefundService],
  exports: [CustomerRefundService],
})
export class CustomerRefundModule {}
