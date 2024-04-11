import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from 'src/common/dto/order-pagination.dto';
import { PaidOrderDto, UpdateOrderStatusDto } from './dto';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces/order-with-products.interface';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database Connected');
  }
  private readonly logger = new Logger('OrdersService');

  constructor(@Inject(NATS_SERVICE) private readonly natsClient: ClientProxy) {
    super();
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] = await firstValueFrom(
        this.natsClient.send({ cmd: 'validate_products' }, productIds),
      );

      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId,
        ).price;
        return acc + price * orderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                quantity: orderItem.quantity,
                productId: orderItem.productId,
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              productId: true,
              quantity: true,
              price: true,
            },
          },
        },
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId)
            .name,
        })),
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.PRECONDITION_FAILED,
        message: error.message,
      });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit } = orderPaginationDto;
    const total = await this.order.count({
      where: {
        status: orderPaginationDto.status,
      },
    });
    const totalPages = Math.ceil(total / limit);
    if (page > totalPages) {
      return [];
    }
    return {
      data: await this.order.findMany({
        where: {
          status: orderPaginationDto.status,
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      meta: {
        total: total,
        current: page,
        totalPages: totalPages,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          },
        },
      },
    });
    if (!order) {
      throw new RpcException({
        message: `Order with id ${id} not found`,
        status: HttpStatus.NOT_FOUND,
      });
    }

    const productIds = order.OrderItem.map((orderItem) => orderItem.productId);
    const products: any[] = await firstValueFrom(
      this.natsClient.send({ cmd: 'validate_products' }, productIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId)
          .name,
      })),
    };
  }

  async updateStatus(updateOrderStatusDto: UpdateOrderStatusDto) {
    const { id, status } = updateOrderStatusDto;
    const order = await this.findOne(id);
    if (order.status !== status) {
      return await this.order.update({
        where: { id },
        data: { status },
      });
    }
    return order;
  }

  async createPaymentSession(orderWithProducts: OrderWithProducts) {
    return await firstValueFrom(
      this.natsClient.send('create.payment.session', {
        orderId: orderWithProducts.id,
        currency: 'usd',
        items: orderWithProducts.OrderItem.map((item) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
      }),
    );
  }

  async markPaidOrder(paidOrderDto: PaidOrderDto) {
    this.logger.log('Marked order as paid: ', paidOrderDto);
    await this.order.update({
      where: {
        id: paidOrderDto.orderId,
      },
      data: {
        status: OrderStatus.PAID,
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,

        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl,
          },
        },
      },
    });
    return this.order;
  }
}
