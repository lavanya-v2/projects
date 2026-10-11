import AddIcon from "@mui/icons-material/Add";
import { Typography, Button, Box } from "@mui/material";

export function ActionItemHeader({ tabName, isLead, handleOpenCreateDialog }: { tabName: string; isLead?: boolean; handleOpenCreateDialog: () => void }) {
  return (
    <Box
      sx={{
        px: 2.5,
        py: 1.75,
        background: "linear-gradient(180deg, #f8fafc 0%, #fff 100%)",
        borderBottom: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
      }}
    >
      <Box
        sx={{
          width: 4,
          height: 22,
          bgcolor: "primary.main",
          borderRadius: 0.5,
          flexShrink: 0,
        }}
      />
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 700,
          color: "#0f172a",
          flex: 1,
        }}
      >
        {tabName} Action Items
      </Typography>
      {((tabName === 'Account' && !isLead) || (tabName !== 'Account')) && (
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={handleOpenCreateDialog}
        >
          New {tabName} Item
        </Button>)}
    </Box>
  )
}