import React, { useCallback, useContext } from "react";
import { Formik, Form } from "formik";
import { Snackbar } from "@rmwc/snackbar";
import { GlobalHotKeys } from "react-hotkeys";

import { gql, useMutation } from "@apollo/client";
import { formatError } from "../util/error";
import { GET_PENDING_CHANGES } from "./PendingChanges";
import { GET_LAST_COMMIT } from "./LastCommit";
import { TextField } from "../Components/TextField";
import { Button, EnumButtonStyle } from "../Components/Button";
import PendingChangesContext from "../VersionControl/PendingChangesContext";
import { CROSS_OS_CTRL_ENTER } from "../util/hotkeys";
import "./Commit.scss";

type CommitType = {
  message: string;
};
const INITIAL_VALUES: CommitType = {
  message: "",
};

type Props = {
  applicationId: string;
  onComplete?: () => void;
};
const CLASS_NAME = "commit";

const keyMap = {
  SUBMIT: CROSS_OS_CTRL_ENTER,
};

const Commit = ({ applicationId, onComplete }: Props) => {
  const pendingChangesContext = useContext(PendingChangesContext);

  const [commit, { error, loading }] = useMutation(COMMIT_CHANGES, {
    onCompleted: (data) => {
      pendingChangesContext.reset();
      onComplete && onComplete();
    },
    refetchQueries: [
      {
        query: GET_PENDING_CHANGES,
        variables: {
          applicationId: applicationId,
        },
      },
      {
        query: GET_LAST_COMMIT,
        variables: {
          appId: applicationId,
        },
      },
    ],
  });

  const handleSubmit = useCallback(
    (data: CommitType) => {
      commit({
        variables: {
          message: data.message,
          appId: applicationId,
        },
      }).catch(console.error);
    },
    [applicationId, commit]
  );

  const errorMessage = formatError(error);

  return (
    <div className={CLASS_NAME}>
      <Formik
        initialValues={INITIAL_VALUES}
        onSubmit={handleSubmit}
        validateOnMount
      >
        {(formik) => {
          const handlers = {
            SUBMIT: formik.submitForm,
          };

          return (
            <Form>
              <GlobalHotKeys keyMap={keyMap} handlers={handlers} />
              <TextField
                rows={3}
                textarea
                name="message"
                label="Type in a commit message"
                disabled={loading}
                autoFocus
                hideLabel
                placeholder="Type in a commit message"
                autoComplete="off"
              />
              <Button
                type="submit"
                buttonStyle={EnumButtonStyle.Primary}
                eventData={{
                  eventName: "commit",
                }}
              >
                Commit Changes
              </Button>
            </Form>
          );
        }}
      </Formik>
      <Snackbar open={Boolean(error)} message={errorMessage} />
    </div>
  );
};

export default Commit;

const COMMIT_CHANGES = gql`
  mutation commit($message: String!, $appId: String!) {
    commit(data: { message: $message, app: { connect: { id: $appId } } }) {
      id
    }
  }
`;
