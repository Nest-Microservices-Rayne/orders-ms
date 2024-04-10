import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { OrderStatusList } from 'src/orders/enum/order.enum';
import { PaginationDto } from './pagination.dto';

export class OrderPaginationDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrderStatusList, {
    message: `Possible status values: ${OrderStatusList}`,
  })
  status: OrderStatus;
}
