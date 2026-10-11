import dayjs from "dayjs";

export const handleDateChange = (
  startDate: string,
  endDate: string,
  setFrom: (d: string) => void,
  setTo: (d: string) => void,
  setStartError: (msg: string) => void,
  setEndError: (msg: string) => void,
  isPortfolio: boolean,
) => {
  setFrom(startDate);
  setTo(endDate);

  const today = dayjs();
  const minStart = today.subtract(12, "month");
  const maxStartDate = isPortfolio ? today.subtract(1, "day") : today;

  let startErr = "";
  let endErr = "";

  // Validate start date independently
  if (startDate) {
    const start = dayjs(startDate);

    if (start.isBefore(minStart, "day")) {
      startErr = `Start date cannot be before ${minStart.format("YYYY-MM-DD")}.`;
    } else if (start.isAfter(maxStartDate, "day")) {
      startErr = `Start date cannot be after ${maxStartDate.format("YYYY-MM-DD")}.`;
    }
  }

  // Validate end date independently
  if (endDate) {
    const end = dayjs(endDate);

    if (end.isAfter(today, "day")) {
      endErr = `End date cannot be after ${today.format("YYYY-MM-DD")}.`;
    } else if (startDate && end.isBefore(dayjs(startDate), "day")) {
      endErr = "End date cannot be before the start date.";
    }
  }

  setStartError(startErr);
  setEndError(endErr);
};
