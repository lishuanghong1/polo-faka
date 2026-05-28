import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AnnouncementsService } from './announcements.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

enum PopupModeDto {
  ALWAYS = 'ALWAYS',
  ONCE = 'ONCE',
  NONE = 'NONE',
}

class UpsertAnnouncementDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cover?: string;

  @IsOptional()
  @IsBoolean()
  popup?: boolean;

  @IsOptional()
  @IsEnum(PopupModeDto)
  popupMode?: PopupModeDto;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsString()
  startAt?: string;

  @IsOptional()
  @IsString()
  endAt?: string;
}

@ApiTags('announcements')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private svc: AnnouncementsService) {}

  @Public()
  @Get('active')
  active() {
    return this.svc.active();
  }

  @Roles('ADMIN')
  @Get()
  list() {
    return this.svc.listAll();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() body: UpsertAnnouncementDto) {
    return this.svc.create(body);
  }

  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: Partial<UpsertAnnouncementDto>) {
    return this.svc.update(Number(id), body);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(Number(id));
  }
}
