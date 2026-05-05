import {
  IncidentSeverity,
  IncidentStatus,
} from "@/app/generated/prisma/client";

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: "Mới mở",
  INVESTIGATING: "Đang điều tra",
  MITIGATED: "Đã giảm thiểu",
  RESOLVED: "Đã khắc phục",
  CLOSED: "Đóng",
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Nghiêm trọng",
};

export const INCIDENT_STATUS_OPTIONS: Array<{
  value: IncidentStatus | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "OPEN", label: INCIDENT_STATUS_LABELS.OPEN },
  { value: "INVESTIGATING", label: INCIDENT_STATUS_LABELS.INVESTIGATING },
  { value: "MITIGATED", label: INCIDENT_STATUS_LABELS.MITIGATED },
  { value: "RESOLVED", label: INCIDENT_STATUS_LABELS.RESOLVED },
  { value: "CLOSED", label: INCIDENT_STATUS_LABELS.CLOSED },
];

export const INCIDENT_SEVERITY_OPTIONS: Array<{
  value: IncidentSeverity | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Tất cả mức độ" },
  { value: "LOW", label: INCIDENT_SEVERITY_LABELS.LOW },
  { value: "MEDIUM", label: INCIDENT_SEVERITY_LABELS.MEDIUM },
  { value: "HIGH", label: INCIDENT_SEVERITY_LABELS.HIGH },
  { value: "CRITICAL", label: INCIDENT_SEVERITY_LABELS.CRITICAL },
];

export const INCIDENT_UI_ERRORS = {
  LOAD_FAILED: "Không thể tải incident",
  CREATE_FAILED: "Không thể tạo incident",
  UPDATE_FAILED: "Không thể cập nhật incident",
  UPLOAD_FAILED: "Tải file incident thất bại",
  MISSING_INCIDENT_ID: "Không lấy được incident id",
} as const;

export const INCIDENT_API_ERRORS = {
  INVALID_RANGE: "end phải lớn hơn hoặc bằng start",
  SHIFT_NOT_IN_TEAM: "shiftId không thuộc team đã chọn",
  NOT_ASSIGNEE: "Chỉ người trực của ca này mới được tạo incident/report",
  POLICY_SHIFT_MISMATCH: "policyId không khớp với shiftId đã chọn",
  ASSIGNEE_NOT_IN_TEAM: "assigneeId phải là thành viên của team",
  INCIDENT_NOT_FOUND: "Incident không tồn tại",
  PICK_FILE_REQUIRED: "Vui lòng chọn ít nhất một file",
} as const;

