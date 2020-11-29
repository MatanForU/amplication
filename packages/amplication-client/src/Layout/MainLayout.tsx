import React, { useCallback } from "react";
import { Link, useHistory } from "react-router-dom";
import { Drawer, DrawerContent } from "@rmwc/drawer";
import { useApolloClient } from "@apollo/client";
import "@rmwc/drawer/styles";
import { Icon } from "@rmwc/icon";
import { isMobileOnly, isMacOs } from "react-device-detect";

import classNames from "classnames";
import { unsetToken } from "../authentication/authentication";
import logo from "../assets/logo.svg";
import { ReactComponent as LogoTextual } from "../assets/logo-textual.svg";
import "./MainLayout.scss";
import CommandPalette from "../CommandPalette/CommandPalette";
import MenuItem from "./MenuItem";
import UserBadge from "../Components/UserBadge";
import { MenuFixedPanel } from "../util/teleporter";

type Props = {
  children: React.ReactNode;
  className?: string;
};

function MainLayout({ children, className }: Props) {
  return (
    <div
      className={classNames("main-layout", className, {
        "main-layout--mobile": isMobileOnly,
      })}
    >
      {children}
    </div>
  );
}

type MenuProps = {
  children: React.ReactNode;
};

const Menu = ({ children }: MenuProps) => {
  const history = useHistory();

  const apolloClient = useApolloClient();

  const handleSignOut = useCallback(() => {
    /**@todo: sign out on server */
    unsetToken();
    apolloClient.clearStore();

    history.replace("/");
  }, [history, apolloClient]);

  return (
    <Drawer className={classNames("main-layout__side")}>
      <DrawerContent className="main-layout__side__wrapper">
        <div className="main-layout__side__wrapper__main-menu">
          <div className="logo-container">
            <Link to="/" className="logo-container__logo">
              <Icon icon={logo} />
              <LogoTextual />
            </Link>
          </div>

          <div className="menu-container">
            <CommandPalette
              trigger={
                <MenuItem
                  title="Search"
                  icon="search_outline"
                  overrideTooltip={`Search (${isMacOs ? "⌘" : "Ctrl"}+Shift+P)`}
                />
              }
            />
            {children}
          </div>
          <div className="bottom-menu-container">
            <MenuItem icon="plus" hideTooltip>
              <UserBadge />
            </MenuItem>

            <MenuItem
              title="Sign Out"
              icon="log_out_outline"
              onClick={handleSignOut}
            />
          </div>
        </div>
        <MenuFixedPanel.Target className="main-layout__side__wrapper__menu-fixed-panel" />
      </DrawerContent>
    </Drawer>
  );
};

MainLayout.Menu = Menu;

type ContentProps = {
  children?: React.ReactNode;
};

const Content = ({ children }: ContentProps) => {
  return <div className="main-layout__content">{children}</div>;
};

MainLayout.Content = Content;

export default MainLayout;
