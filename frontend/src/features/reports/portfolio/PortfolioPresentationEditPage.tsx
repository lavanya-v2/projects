import { Box, CircularProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { PATHS } from "../../../routes/paths";
import { NotFound } from "../../../shared/components/NotFound";
import { usePortfolioPresentation } from "./hooks";
import { PortfolioPresentationForm } from "./PortfolioPresentationForm";
import { useState } from "react";
import { useAccount } from "../../../context/UseAccount";
import ConfirmationDialog from "../../../shared/components/ConfirmationDialog";

export function PortfolioPresentationEditPage() {
  const navigate = useNavigate();
  const { activeAccount } = useAccount();
  const { id } = useParams<{ id: string }>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const numericId = id ? Number(id) : NaN;
  const isEditMode = Number.isFinite(numericId);
  const { data, isLoading, isError } = usePortfolioPresentation(
    isEditMode ? numericId : null,
  );
  const forceCloseForm = () => {
    if (isEditMode) {
      setConfirmOpen(false);
    }
    navigate(PATHS.PORTFOLIO_PRESENTATION);
  };
  const handleCloseAttempt = (isFormModified: boolean | undefined) => {
    if (isEditMode && isFormModified) {
      setConfirmOpen(true);
    } else {
      forceCloseForm();
    }
  };
  if (isError) {
    return <NotFound />;
  }
  if (isEditMode && (isLoading || !data)) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {activeAccount && (
        <PortfolioPresentationForm
          open
          accountId={activeAccount.id}
          accountName={activeAccount.name}
          existing={isEditMode ? data : undefined}
          onClose={handleCloseAttempt}
          onSaved={() => {
            navigate(PATHS.PORTFOLIO_PRESENTATION, {
              state: { formType: isEditMode ? "updated" : "create" },
            });
          }}
        />
      )}
      {confirmOpen && (
        <ConfirmationDialog
          title={"Unsaved Changes"}
          message={"You have some unsaved changes, do you want to close it?"}
          action={"Yes"}
          closeButtonText={"No"}
          ActionButtonColor={"primary"}
          confirm={forceCloseForm}
          setShowAlert={setConfirmOpen}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
