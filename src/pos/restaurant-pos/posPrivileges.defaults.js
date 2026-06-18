/**
 * Static POS privileges until privilege setup is implemented (DB/UI later).
 * Flutter `isControlEnabled(ref, 'btnSaveKOT')` expects **ControlName** + **IsEnable**.
 */
export function getStaticPrivilegesForFlutter() {
  const rows = [
    ['btnSaveKOT', 'Save KOT'],
    ['btnPrintKOT', 'Print KOT'],
    ['btnKOTReprint', 'Reprint KOT'],
    ['btnBillCancel', 'Cancel bill'],
    ['btnDiscount', 'Discount'],
    ['btnDummyBill', 'Dummy bill'],
    ['btnComments', 'Comments'],
    ['btnAreaMaster', 'Area master'],
    ['btnSettlement', 'Settlement'],
    ['btnSalesViewer', 'Sales viewer'],
    ['btnReturnBill', 'Return bill'],
    ['btnControlPanel', 'Control panel'],
    ['btnCounterClose', 'Counter close'],
    ['btnWaiterAssignment', 'Waiter assignment'],
  ];
  return rows.map(([ControlName, label]) => ({
    ControlName,
    IsEnable: true,
    key: ControlName,
    label,
    enabled: true,
  }));
}
