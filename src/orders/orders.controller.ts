import { Controller, ParseUUIDPipe } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';
import { OrderPaginationDto } from 'src/common/dto/order-pagination.dto';
import { PaidOrderDto, UpdateOrderStatusDto } from './dto';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @MessagePattern({ cmd: 'create_order' })
  async create(@Payload() createOrderDto: CreateOrderDto) {
    const order = await this.ordersService.create(createOrderDto);
    const paymentSession = await this.ordersService.createPaymentSession(order);

    return {
      order,
      paymentSession,
    };
  }

  @MessagePattern({ cmd: 'find_all_orders' })
  findAll(@Payload() orderPaginationDto: OrderPaginationDto) {
    return this.ordersService.findAll(orderPaginationDto);
  }

  @MessagePattern({ cmd: 'find_one_order' })
  findOne(@Payload('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @MessagePattern({ cmd: 'update_order_status' })
  updateStatus(@Payload() updateOrderStatusDto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(updateOrderStatusDto);
  }

  @EventPattern('payment.succeeded')
  paidOrder(@Payload() paidOrderDto: PaidOrderDto) {
    return this.ordersService.markPaidOrder(paidOrderDto);
  }
}
