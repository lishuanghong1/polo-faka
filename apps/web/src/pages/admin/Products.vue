<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import RichTextEditor from '@/components/RichTextEditor.vue';

const list = ref<any[]>([]);
const cats = ref<any[]>([]);
const editing = ref<any | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const a = await api.products({ pageSize: 100 });
    list.value = a.items;
    cats.value = await api.categories();
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function startEdit(p: any) {
  editing.value = JSON.parse(JSON.stringify(p));
  if (Array.isArray(editing.value.tags)) {
    editing.value._tagsStr = editing.value.tags.join(',');
  } else {
    editing.value._tagsStr = editing.value.tags || '';
  }
  if (Array.isArray(editing.value.bulkPricing)) {
    editing.value._bulkStr = JSON.stringify(editing.value.bulkPricing);
  }
}

function newProduct() {
  editing.value = {
    categoryId: cats.value.find((c) => c.slug !== 'all')?.id ?? cats.value[0]?.id,
    title: '',
    subtitle: '',
    description: '',
    cover: '',
    basePrice: 0,
    _tagsStr: '',
    _bulkStr: '',
    warranty: '',
    skus: [{ name: '默认规格', price: 0, sort: 0, visible: true }],
    status: 'ON_SALE',
    deliveryType: 'CARD_KEY',
  };
}

async function save() {
  if (!editing.value.title) {
    ElMessage.warning('请填写商品标题');
    return;
  }
  const payload: any = { ...editing.value };
  payload.tags = (payload._tagsStr || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  if (payload._bulkStr?.trim()) {
    try {
      payload.bulkPricing = JSON.parse(payload._bulkStr);
    } catch {
      ElMessage.error('批量优惠 JSON 格式有误');
      return;
    }
  } else {
    payload.bulkPricing = null;
  }
  delete payload._tagsStr;
  delete payload._bulkStr;

  if (payload.id) {
    await api.admin.productsUpdate(payload.id, payload);
  } else {
    await api.admin.productsCreate(payload);
  }
  ElMessage.success('已保存');
  editing.value = null;
  load();
}

async function del(p: any) {
  await ElMessageBox.confirm(
    `确认删除商品「${p.title}」？\n该商品下所有规格和卡密会一并删除（已售卡密保留）。`,
    '危险操作',
    { type: 'warning' },
  );
  await api.admin.productsRemove(p.id);
  ElMessage.success('已删除');
  load();
}

async function toggleStatus(p: any) {
  const next = p.status === 'ON_SALE' ? 'OFF_SHELF' : 'ON_SALE';
  await api.admin.productsSetStatus(p.id, next);
  ElMessage.success(next === 'ON_SALE' ? '已上架' : '已下架');
  load();
}

function addSku() {
  editing.value.skus.push({ name: '', price: 0, sort: editing.value.skus.length, visible: true });
}
function removeSku(i: number) {
  editing.value.skus.splice(i, 1);
}
</script>

<template>
  <AdminPageHeader title="商品" subtitle="管理商城在售商品与规格">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="newProduct">
        + 新建商品
      </button>
    </template>
  </AdminPageHeader>

  <DataTable :loading="loading" :is-empty="!list.length">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>商品</th>
        <th>分类</th>
        <th class="!text-right">起价</th>
        <th class="!text-right">库存</th>
        <th class="!text-right">销量</th>
        <th>状态</th>
        <th class="!text-right" style="width: 180px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in list" :key="p.id">
        <td class="text-ink-400 font-mono text-xs">#{{ p.id }}</td>
        <td>
          <div class="flex items-center gap-3">
            <img
              v-if="p.cover"
              :src="p.cover"
              class="w-10 h-10 rounded-lg object-cover border border-ink-100 shrink-0"
            />
            <div
              v-else
              class="w-10 h-10 rounded-lg bg-ink-100 text-ink-400 flex items-center justify-center text-xs shrink-0"
            >
              {{ p.title[0]?.toUpperCase() }}
            </div>
            <div class="min-w-0">
              <div class="font-medium text-ink-900 truncate">{{ p.title }}</div>
              <div v-if="p.subtitle" class="text-xs text-ink-500 truncate">{{ p.subtitle }}</div>
            </div>
          </div>
        </td>
        <td class="text-ink-600">{{ p.category?.name }}</td>
        <td class="text-right font-medium text-price">¥{{ p.basePrice }}</td>
        <td class="text-right">
          <span :class="(p.totalStock ?? 0) < 5 ? 'text-amber-700 font-semibold' : 'text-ink-700'">
            {{ p.totalStock ?? 0 }}
          </span>
        </td>
        <td class="text-right text-ink-600">{{ p.sales }}</td>
        <td>
          <button
            class="text-xs px-2 py-0.5 rounded-md border whitespace-nowrap"
            :class="p.status === 'ON_SALE'
              ? 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100'
              : 'bg-ink-100 text-ink-500 border-ink-200 hover:bg-ink-200'"
            @click="toggleStatus(p)"
          >
            {{ p.status === 'ON_SALE' ? '在售' : p.status === 'OFF_SHELF' ? '下架' : '草稿' }}
          </button>
        </td>
        <td class="text-right whitespace-nowrap">
          <button class="text-ink-500 hover:text-brand-700 mr-3 text-sm" @click="startEdit(p)">编辑</button>
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(p)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <el-dialog
    :model-value="!!editing"
    :show-close="true"
    width="720px"
    :title="editing?.id ? '编辑商品' : '新建商品'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-4 text-sm">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-ink-500 mb-1">分类</label>
          <select v-model="editing.categoryId" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">状态</label>
          <select v-model="editing.status" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option value="ON_SALE">在售</option>
            <option value="OFF_SHELF">下架</option>
            <option value="DRAFT">草稿</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">标题</label>
        <input v-model="editing.title" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="商品标题" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">副标题</label>
        <input v-model="editing.subtitle" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="如：新品稳定成品号" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">封面图 URL（可选）</label>
        <div class="flex items-center gap-3">
          <input
            v-model="editing.cover"
            class="flex-1 px-3 py-2 border border-ink-200 rounded-lg"
            placeholder="https://..."
          />
          <img
            v-if="editing.cover"
            :src="editing.cover"
            class="w-10 h-10 rounded-lg object-cover border border-ink-100"
            alt=""
          />
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">详细描述（前台商品详情显示，支持富文本）</label>
        <RichTextEditor v-model="editing.description" height="280px" />
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-ink-500 mb-1">起价（列表展示用）</label>
          <input v-model.number="editing.basePrice" type="number" step="0.01" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">标签（逗号分隔）</label>
          <input
            v-model="editing._tagsStr"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg"
            placeholder="新品,热销,质保"
          />
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">质保说明（可选）</label>
        <input v-model="editing.warranty" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="如：默认无质保 / 七天内掉了我直接补新的" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">批量优惠 JSON（可选）</label>
        <input
          v-model="editing._bulkStr"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
          placeholder='例如：[{"min":1,"max":9,"price":0.5},{"min":10,"max":30,"price":0.45}]'
        />
      </div>

      <div class="border-t border-ink-100 pt-4">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-ink-900">规格 SKU</span>
          <button class="text-brand-700 hover:text-brand-800 text-xs" @click="addSku">+ 添加规格</button>
        </div>
        <div class="grid grid-cols-[1fr_100px_70px_30px] gap-2 text-[11px] text-ink-400 px-1 mb-1">
          <span>规格名</span>
          <span class="text-right pr-2">价格</span>
          <span class="text-right pr-2">排序</span>
          <span></span>
        </div>
        <div v-for="(s, i) in editing.skus" :key="i" class="grid grid-cols-[1fr_100px_70px_30px] gap-2 mb-2">
          <input v-model="s.name" placeholder="规格名" class="px-3 py-2 border border-ink-200 rounded-lg text-sm" />
          <input v-model.number="s.price" type="number" step="0.01" placeholder="价格" class="px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          <input v-model.number="s.sort" type="number" placeholder="排序" class="px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          <button class="text-ink-400 hover:text-rose-600 text-lg" @click="removeSku(i)">×</button>
        </div>
        <p v-if="editing.id" class="text-[11px] text-ink-400 mt-1">
          提示：删除规格时如果该规格还有售出/锁定的卡密，保存会失败。
        </p>
      </div>
    </div>

    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="save">保存</button>
    </template>
  </el-dialog>
</template>
