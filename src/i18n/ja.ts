import type { Dictionary } from './types'

const ja: Dictionary = {
  app: {
    name: 'どこどこ',
  },
  nav: {
    search: '検索',
    movement: '入出庫',
    inventory: '棚卸',
    settings: '設定',
  },
  home: {
    offlineQueuePending: '未送信の移動 {count} 件',
    offlineQueueEmpty: 'すべて同期済み',
    lastExport: '前回のエクスポート：{date}',
    movementsToday: '本日の移動 {count} 件',
  },
  common: {
    cancel: 'キャンセル',
    confirm: '確認',
    validate: '確定',
    back: '戻る',
    add: '追加',
    save: '保存',
    loading: '読み込み中…',
  },
  motifs: {
    reception: '入庫',
    retour_client: '返品',
    stock_initial: '初期在庫',
    ajustement_inventaire: '棚卸調整',
    annulation: '取消',
    transfert_entree: '移動入庫',
    commande_client: '出荷',
    produit_defaillant: '不良品',
    destruction: '廃棄',
    transfert_sortie: '移動出庫',
  },
}

export default ja
