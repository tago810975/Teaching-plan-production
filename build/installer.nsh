!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER

Var LibraryDirDialog
Var LibraryDirLabel
Var LibraryDirText
Var LibraryDirBrowse
Var LibraryDir

!macro customPageAfterChangeDir
  Page custom LibraryDirPageCreate LibraryDirPageLeave

  Function LibraryDirPageCreate
    !insertmacro MUI_HEADER_TEXT "选择教学案库位置" "请选择用于存放教学案工程文件与自制模板的文件夹（必选）。"

    ${If} $LibraryDir == ""
      ReadRegStr $LibraryDir HKCU "Software\TeachingPlan" "LibraryDir"
    ${EndIf}

    nsDialogs::Create 1018
    Pop $LibraryDirDialog
    ${If} $LibraryDirDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 10u 100% 24u "请为软件选择教学案库文件夹（后续新建的教学案、墨案导入的教案及自制模板都将保存在这里，可在软件“设置…”中随时更改）："
    Pop $LibraryDirLabel

    ${NSD_CreateDirRequest} 0 42u 78% 14u "$LibraryDir"
    Pop $LibraryDirText

    ${NSD_CreateBrowseButton} 80% 41u 20% 16u "浏览(&B)..."
    Pop $LibraryDirBrowse
    ${NSD_OnClick} $LibraryDirBrowse LibraryDirBrowseClick

    nsDialogs::Show
  FunctionEnd

  Function LibraryDirBrowseClick
    ${NSD_GetText} $LibraryDirText $0
    nsDialogs::SelectFolderDialog "选择教学案库文件夹" "$0"
    Pop $0
    ${If} $0 != error
      ${NSD_SetText} $LibraryDirText "$0"
    ${EndIf}
  FunctionEnd

  Function LibraryDirPageLeave
    ${NSD_GetText} $LibraryDirText $LibraryDir
    ${If} $LibraryDir == ""
      MessageBox MB_ICONEXCLAMATION|MB_OK "请先选择教学案库的地址后再继续安装。"
      Abort
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  ${If} $LibraryDir != ""
    CreateDirectory "$LibraryDir"
    WriteRegStr HKCU "Software\TeachingPlan" "LibraryDir" "$LibraryDir"
    FileOpen $0 "$INSTDIR\resources\installer-library-dir.txt" w
    ${If} $0 != ""
      FileWriteUTF16LE $0 "$LibraryDir"
      FileClose $0
    ${EndIf}
  ${EndIf}
!macroend

!endif
