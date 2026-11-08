#!/usr/bin/env python3
"""Convert the supplied Excel workbook's saved values into the app's import JSON."""

import argparse
import json
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook


SETTING_DEFAULTS = {
    "basic_pct": 0.5,
    "hra_pct": 0.4,
    "bonus_pct": 0.0833,
    "statutory_wage_pct": 0.5,
    "statutory_wage_addback": 0,
    "pf_rate": 0.12,
    "pf_wage_cap": 15000,
    "pf_ctc_threshold": 30000,
    "esic_employee_rate": 0.0075,
    "esic_employer_rate": 0.0325,
    "esic_wage_cap": 21000,
    "professional_tax": 200,
    "ctc_factor_both": 1.13415,
    "ctc_factor_pf_below": 1.10165,
    "ctc_factor_pf_above": 1.07415,
    "ctc_factor_esic_below": 1.07415,
    "ctc_factor_esic_above": 1.04165,
}


def iso_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str) and value:
        return value[:10]
    return None


def number(value, default=0):
    return float(value) if isinstance(value, (int, float)) else default


def yes(value):
    return str(value or "").strip().lower() == "yes"


def text(value):
    return "" if value is None else str(value).strip()


def extract_workbook(path):
    workbook = load_workbook(path, data_only=True, read_only=False)
    required = {
        "Employee List",
        "Salary Revision",
        "Attendance",
        "Payroll",
        "Rule Settings",
        "Holiday List",
    }
    missing = required.difference(workbook.sheetnames)
    if missing:
        raise ValueError(f"Workbook is missing required worksheets: {', '.join(sorted(missing))}")

    data = {
        "employees": [],
        "salary_revisions": [],
        "attendance_days": [],
        "holidays": [],
        "payroll_adjustments": [],
        "payroll_settings": dict(SETTING_DEFAULTS),
    }

    employees_sheet = workbook["Employee List"]
    for row in range(4, employees_sheet.max_row + 1):
        employee_id = text(employees_sheet.cell(row, 1).value)
        name = text(employees_sheet.cell(row, 2).value)
        if not employee_id or not name:
            continue
        data["employees"].append(
            {
                "id": employee_id,
                "name": name,
                "department": text(employees_sheet.cell(row, 3).value),
                "designation": text(employees_sheet.cell(row, 4).value),
                "area": text(employees_sheet.cell(row, 5).value),
                "joining_date": iso_date(employees_sheet.cell(row, 6).value),
                "relieving_date": iso_date(employees_sheet.cell(row, 7).value),
                "monthly_ctc": number(employees_sheet.cell(row, 8).value),
                "pf_applicable": yes(employees_sheet.cell(row, 9).value),
                "esic_applicable": yes(employees_sheet.cell(row, 10).value),
                "pan": text(employees_sheet.cell(row, 18).value),
                "uan": text(employees_sheet.cell(row, 19).value),
                "esic_number": text(employees_sheet.cell(row, 20).value),
                "email": text(employees_sheet.cell(row, 21).value),
                "bank_account": text(employees_sheet.cell(row, 22).value),
                "ifsc": text(employees_sheet.cell(row, 23).value),
                "active": text(employees_sheet.cell(row, 17).value).lower() != "inactive",
            }
        )

    revision_sheet = workbook["Salary Revision"]
    revision_order = 0
    for row in range(4, revision_sheet.max_row + 1):
        employee_id = text(revision_sheet.cell(row, 2).value)
        effective_date = iso_date(revision_sheet.cell(row, 4).value)
        ctc = revision_sheet.cell(row, 5).value
        if not employee_id or not effective_date or ctc is None:
            continue
        revision_order += 1
        data["salary_revisions"].append(
            {
                "id": f"workbook-revision-{row}",
                "employee_id": employee_id,
                "effective_date": effective_date,
                "monthly_ctc": number(ctc),
                "reason": text(revision_sheet.cell(row, 8).value),
                "source_order": revision_order,
            }
        )

    attendance_sheet = workbook["Attendance"]
    for row in range(4, attendance_sheet.max_row + 1):
        month_date = iso_date(attendance_sheet.cell(row, 1).value)
        employee_id = text(attendance_sheet.cell(row, 2).value)
        if not month_date or not employee_id:
            continue
        month = month_date[:7]
        for day in range(1, 32):
            status = attendance_sheet.cell(row, day + 3).value
            if status not in {"P", "R", "A", "CL", "SL", "L", "WO", "H"}:
                continue
            data["attendance_days"].append(
                {
                    "employee_id": employee_id,
                    "work_date": f"{month}-{day:02d}",
                    "status": status,
                }
            )

    holiday_sheet = workbook["Holiday List"]
    for row in range(2, holiday_sheet.max_row + 1):
        holiday_date = iso_date(holiday_sheet.cell(row, 1).value)
        name = text(holiday_sheet.cell(row, 2).value)
        if not holiday_date or not name:
            continue
        data["holidays"].append(
            {
                "id": f"workbook-holiday-{row}",
                "holiday_date": holiday_date,
                "name": name,
                "paid": yes(holiday_sheet.cell(row, 4).value),
            }
        )

    payroll_sheet = workbook["Payroll"]
    for row in range(4, payroll_sheet.max_row + 1):
        month_date = iso_date(payroll_sheet.cell(row, 1).value)
        employee_id = text(payroll_sheet.cell(row, 2).value)
        if not month_date or not employee_id:
            continue
        reimbursement = payroll_sheet.cell(row, 14).value
        advance = payroll_sheet.cell(row, 20).value
        if reimbursement is None and advance is None:
            continue
        data["payroll_adjustments"].append(
            {
                "employee_id": employee_id,
                "payroll_month": month_date[:7],
                "reimbursement": number(reimbursement),
                "advance_deduction": number(advance),
            }
        )

    rules = workbook["Rule Settings"]
    data["payroll_settings"].update(
        {
            "basic_pct": number(rules["B3"].value, 0.5),
            "hra_pct": number(rules["B4"].value, 0.4),
            "bonus_pct": number(rules["B5"].value, 0.0833),
            "statutory_wage_pct": number(rules["B6"].value, 0.5),
            "statutory_wage_addback": 0,
        }
    )
    workbook.close()
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="Path to the Excel workbook")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("salary-workbook-import.json"),
        help="Output JSON file (default: salary-workbook-import.json)",
    )
    args = parser.parse_args()
    if not args.workbook.is_file():
        parser.error(f"Workbook does not exist: {args.workbook}")
    result = {
        "format": "salary-workbook-import-v1",
        "source": args.workbook.name,
        "data": extract_workbook(args.workbook),
    }
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    counts = {
        key: len(value) if isinstance(value, list) else len(value)
        for key, value in result["data"].items()
    }
    print(f"Workbook data exported to {args.output}")
    print(json.dumps(counts, sort_keys=True))


if __name__ == "__main__":
    main()
